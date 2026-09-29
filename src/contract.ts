import {
  Color,
  DirectionalLight,
  Group,
  Light,
  Material,
  Mesh,
  Object3D,
  ObjectLoader,
  PerspectiveCamera,
  RectAreaLight,
  Scene,
  SpotLight,
  Vector3,
} from "three";
import { defaultPostFX } from "../packages/shared/src/signals/ui";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { disposeTrees } from "../apps/playground/src/three/resources";

export const SCHEMA_VERSION = 2;
export interface StudioSettings {
  world: { color: string; intensity: number };
  bake: {
    resolution: number;
    samples: number;
    bounces: number;
    denoise: boolean;
  };
}
export const defaults = (): StudioSettings => ({
  world: { color: "#17191d", intensity: 0.15 },
  bake: { resolution: 256, samples: 16, bounces: 2, denoise: true },
});
export interface MeshBake {
  receive: boolean;
  contribute: boolean;
  density: number;
}
export function meshBake(o: Object3D): MeshBake {
  return {
    receive: true,
    contribute: true,
    density: 1,
    ...o.userData.lightbakerMesh,
  };
}
export function validateSettings(value: unknown): StudioSettings {
  const s = value as StudioSettings;
  if (!s?.world || !/^#[\da-f]{6}$/i.test(s.world.color))
    throw new Error("Invalid world color");
  const check = (n: number, min: number, max: number, integer = false) => {
    if (
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (integer && !Number.isInteger(n))
    )
      throw new Error("Invalid Studio settings");
  };
  check(s.world.intensity, 0, 4);
  check(s.bake?.resolution, 128, 1024, true);
  check(s.bake.samples, 4, 128, true);
  check(s.bake.bounces, 0, 4, true);
  if (typeof s.bake.denoise !== "boolean")
    throw new Error("Invalid denoise setting");
  return structuredClone(s);
}

const runtimeKeys = new Set([
  "lightHelper",
  "cameraHelper",
  "lightTarget",
  "lightmapIgnore",
  "lightGizmo",
  "editorOnly",
  "eslPostFX",
  "eslLightmapMode",
]);
function cleanData(o: Object3D): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(o.userData)) {
    if (
      runtimeKeys.has(key) ||
      typeof value === "function" ||
      value instanceof Object3D
    )
      continue;
    data[key] = value;
  }
  data.studioId = o.uuid;
  data.lightbakerVisible = o.visible;
  if (o instanceof Mesh) data.lightbakerMesh = meshBake(o);
  return JSON.parse(JSON.stringify(data));
}

/** Synchronous snapshot: never gives exporter live scene, helpers, or circular runtime userData. */
export function authoredSnapshot(roots: Object3D[]): Group {
  const root = new Group();
  const copies = new Map<Object3D, Object3D>();
  const copy = (source: Object3D): Object3D | null => {
    if (source.userData.editorOnly || source.userData.lightGizmo) return null;
    const original = source.userData;
    let node: Object3D;
    const children = source.children;
    try {
      source.userData = cleanData(source);
      source.children = [];
      node = source.clone(false);
    } finally {
      source.userData = original;
      source.children = children;
    }
    // Some Three subclasses (Light) ignore clone(false) and copy children anyway.
    node.clear();
    node.uuid = source.uuid;
    // Source geometry is immutable during synchronous snapshot; clone so export cannot race edits.
    if (node instanceof Mesh) {
      node.geometry = (source as Mesh).geometry.clone();
      const material = (source as Mesh).material;
      node.material = Array.isArray(material)
        ? material.map((m) => m.clone())
        : material.clone();
    }
    copies.set(source, node);
    for (const child of source.children) {
      const c = copy(child);
      if (c) node.add(c);
    }
    return node;
  };
  for (const r of roots) {
    const c = copy(r);
    if (c) root.add(c);
  }
  for (const [source, node] of copies) {
    if (
      (source instanceof SpotLight || source instanceof DirectionalLight) &&
      (node instanceof SpotLight || node instanceof DirectionalLight)
    ) {
      node.target = copies.get(source.target) ?? source.target.clone();
      if (!node.target.parent) root.add(node.target);
    }
  }
  root.updateMatrixWorld(true);
  return root;
}

export interface ViewMetadata {
  position: number[];
  target: number[];
  fov: number;
  near: number;
  far: number;
  mode: string;
  grid: boolean;
  axes: boolean;
  flySpeed: number;
  postFX: Record<string, unknown>;
}
export interface ProjectDocument {
  format: "lightbaker-studio";
  version: 2;
  preset: string;
  settings: StudioSettings;
  view: ViewMetadata;
  scene: ReturnType<Object3D["toJSON"]>;
}
export function projectDocument(
  roots: Object3D[],
  settings: StudioSettings,
  view: ViewMetadata,
  preset: string,
): ProjectDocument {
  const root = authoredSnapshot(roots);
  try {
    return {
      format: "lightbaker-studio",
      version: SCHEMA_VERSION,
      preset,
      settings: structuredClone(settings),
      view: structuredClone(view),
      scene: root.toJSON(),
    };
  } finally {
    disposeSnapshot(root);
  }
}
export async function parseProject(
  value: unknown,
): Promise<{ root: Object3D; document: ProjectDocument }> {
  const p = value as ProjectDocument;
  if (
    p?.format !== "lightbaker-studio" ||
    p.version !== SCHEMA_VERSION ||
    !p.scene?.object
  )
    throw new Error("Unsupported Studio project");
  validateSettings(p.settings);
  if (
    !p.view ||
    ![p.view.position, p.view.target].every(
      (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
    ) ||
    !Number.isFinite(p.view.fov) ||
    p.view.fov < 10 ||
    p.view.fov > 120
  )
    throw new Error("Invalid camera metadata");
  validateView(p.view);
  const root = await new ObjectLoader().parseAsync(p.scene);
  try {
    root.traverse((o) => {
      if (![...o.position, ...o.quaternion, ...o.scale].every(Number.isFinite))
        throw new Error("Invalid transform");
      if (o instanceof Mesh) {
        const b = meshBake(o);
        if (
          typeof b.receive !== "boolean" ||
          typeof b.contribute !== "boolean" ||
          !Number.isFinite(b.density) ||
          b.density < 0.25 ||
          b.density > 4
        )
          throw new Error("Invalid mesh bake metadata");
      }
    });
  } catch (error) {
    disposeTrees([root]);
    throw error;
  }
  return { root, document: p };
}

export function validateView(view: ViewMetadata): void {
  if (
    !view ||
    ![view.position, view.target].every(
      (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
    )
  )
    throw new Error("Invalid view vectors");
  if (
    !Number.isFinite(view.fov) ||
    view.fov < 10 ||
    view.fov > 120 ||
    !Number.isFinite(view.near) ||
    !Number.isFinite(view.far) ||
    view.near <= 0 ||
    view.far <= view.near
  )
    throw new Error("Invalid view lens");
  const shape = defaultPostFX() as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(view.postFX ?? {})) {
    if (!(key in shape) || typeof shape[key] !== typeof value)
      throw new Error("Invalid view effect field: " + key);
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        Math.abs(value) > (key === "fogColor" ? 0xffffff : 100))
    )
      throw new Error("Invalid view effect");
    if (
      key === "toneMapping" &&
      !["none", "linear", "reinhard", "cineon", "aces", "agx"].includes(
        String(value),
      )
    )
      throw new Error("Invalid tone mapping");
    if (key === "gamma" && (typeof value !== "number" || value <= 0))
      throw new Error("Invalid gamma");
  }
}

export function disposeSnapshot(root: Object3D): void {
  // Textures remain shared with the authoring graph; only snapshot clones are owned here.
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
    }
  });
}

/** Restore public metadata after a glTF loader has reconstructed standard geometry/materials/lights. */
export function restoreGLBMetadata(root: Object3D): {
  settings?: StudioSettings;
  view?: ViewMetadata;
} {
  const metadata = root.userData.lightbaker;
  let settings: StudioSettings | undefined;
  let view: ViewMetadata | undefined;
  if (metadata) {
    if (metadata.version !== 1 && metadata.version !== SCHEMA_VERSION)
      throw new Error("Unsupported LightBaker GLB metadata version");
    settings = validateSettings({ world: metadata.world, bake: metadata.bake });
    if (metadata.view) {
      validateView(metadata.view);
      view = metadata.view;
    }
  }
  const markers: Object3D[] = [];
  root.traverse((o) => {
    if (typeof o.userData.studioId === "string") o.uuid = o.userData.studioId;
    if (typeof o.userData.lightbakerVisible === "boolean")
      o.visible = o.userData.lightbakerVisible;
    if (
      o.userData.lightbakerLight?.type === "area" &&
      !(o instanceof RectAreaLight)
    )
      markers.push(o);
  });
  for (const marker of markers) {
    const m = marker.userData.lightbakerLight;
    if (
      ![m.intensity, m.width, m.height].every(Number.isFinite) ||
      m.width <= 0 ||
      m.height <= 0
    )
      throw new Error("Invalid area light metadata");
    const light = new RectAreaLight(m.color, m.intensity, m.width, m.height);
    light.uuid = marker.uuid;
    light.name = marker.name;
    light.userData = marker.userData;
    light.visible = marker.visible;
    light.position.copy(marker.position);
    light.quaternion.copy(marker.quaternion);
    light.rotateX(-Math.PI / 2);
    light.scale.copy(marker.scale);
    marker.parent!.add(light);
    marker.removeFromParent();
  }
  return { settings, view };
}

/** GLB is the sole public bake boundary. extras.lightbaker is the complete v2 contract. */
export async function exportScene(
  roots: Object3D[],
  settings: StudioSettings,
  view: ViewMetadata,
): Promise<ArrayBuffer> {
  const snapshot = authoredSnapshot(roots);
  const scene = new Scene();
  while (snapshot.children.length) scene.add(snapshot.children[0]!);
  scene.userData.lightbaker = {
    version: SCHEMA_VERSION,
    ...structuredClone(settings),
    view: structuredClone(view),
  };
  scene.userData.lightbakerCamera = {
    position: view.position,
    target: view.target,
    fov: view.fov,
  };
  const area: RectAreaLight[] = [];
  scene.updateMatrixWorld(true);
  const aimed: Array<SpotLight | DirectionalLight> = [];
  scene.traverse((o) => {
    if (o instanceof Light) {
      const light = o as Light & {
        distance?: number;
        decay?: number;
        angle?: number;
        penumbra?: number;
        width?: number;
        height?: number;
      };
      o.userData.lightbakerLight = {
        type:
          o instanceof RectAreaLight
            ? "area"
            : o.type.replace("Light", "").toLowerCase(),
        color: "#" + light.color.getHexString(),
        intensity: light.intensity,
        distance: light.distance,
        decay: light.decay,
        angle: light.angle,
        penumbra: light.penumbra,
        width: light.width,
        height: light.height,
      };
      if (o instanceof RectAreaLight) area.push(o);
      if (o instanceof SpotLight || o instanceof DirectionalLight)
        aimed.push(o);
    }
  });
  // glTF uses the light node's local -Z, whereas Three punctual lights use a target.
  for (const light of aimed) {
    const target = light.target.getWorldPosition(new Vector3());
    light.lookAt(target);
    light.target = new Object3D();
    light.target.position.set(0, 0, -1);
    light.add(light.target);
  }
  // Existing platform rotates marker children -90deg X. Compensate on marker so emitted world orientation is exact.
  for (const light of area) {
    const marker = new Object3D();
    marker.name = light.name;
    marker.uuid = light.uuid;
    marker.position.copy(light.position);
    marker.quaternion.copy(light.quaternion);
    marker.rotateX(Math.PI / 2);
    marker.scale.copy(light.scale);
    marker.visible = light.visible;
    marker.userData = light.userData;
    light.parent!.add(marker);
    light.removeFromParent();
  }
  try {
    return (await new GLTFExporter().parseAsync(scene, {
      binary: true,
      onlyVisible: false,
    })) as ArrayBuffer;
  } finally {
    disposeSnapshot(scene);
  }
}

/** Snapshot just editable fields. References/resources stay attached across undo. */
export function editableState(o: Object3D) {
  const fields = [
    "intensity",
    "distance",
    "decay",
    "angle",
    "penumbra",
    "width",
    "height",
    "fov",
    "aspect",
    "near",
    "far",
    "roughness",
    "metalness",
    "emissiveIntensity",
    "opacity",
    "transparent",
    "side",
    "transmission",
    "ior",
    "thickness",
  ] as const;
  const read = (value: object) =>
    Object.fromEntries([
      ...fields.flatMap((k) =>
        k in value ? [[k, (value as Record<string, unknown>)[k]]] : [],
      ),
      ...["color", "emissive"].flatMap((k) =>
        (value as Record<string, unknown>)[k] instanceof Color
          ? [[k, ((value as Record<string, unknown>)[k] as Color).getHex()]]
          : [],
      ),
    ]);
  const children = o.children.filter(
    (c) => c instanceof Light || c instanceof PerspectiveCamera,
  );
  return {
    name: o.name,
    visible: o.visible,
    position: o.position.toArray(),
    quaternion: o.quaternion.toArray(),
    scale: o.scale.toArray(),
    bake: meshBake(o),
    own: read(o),
    children: children.map(read),
    materials:
      o instanceof Mesh
        ? (Array.isArray(o.material) ? o.material : [o.material]).map(read)
        : [],
  };
}
export function restoreEditable(
  o: Object3D,
  state: ReturnType<typeof editableState>,
): void {
  o.name = state.name;
  o.visible = state.visible;
  o.position.fromArray(state.position);
  o.quaternion.fromArray(state.quaternion);
  o.scale.fromArray(state.scale);
  o.userData.lightbakerMesh = state.bake;
  const apply = (value: object, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      const target = value as Record<string, unknown>;
      if (target[k] instanceof Color) (target[k] as Color).setHex(v as number);
      else target[k] = v;
    }
    if (value instanceof PerspectiveCamera) value.updateProjectionMatrix();
    if (value instanceof Material) value.needsUpdate = true;
  };
  apply(o, state.own);
  o.children
    .filter((c) => c instanceof Light || c instanceof PerspectiveCamera)
    .forEach((c, i) => apply(c, state.children[i]!));
  if (o instanceof Mesh)
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m, i) =>
      apply(m, state.materials[i]!),
    );
  o.updateMatrixWorld(true);
}

/** Content identities permit undo back to a matching bake; selection and navigation are excluded. */
export function bakeIdentity(
  roots: Object3D[],
  settings: StudioSettings,
): string {
  const values: [string, unknown][] = [];
  const visit = (o: Object3D) => {
    if (o.userData.editorOnly || o.userData.lightGizmo) return;
    values.push([o.uuid, [o.parent?.uuid, editableState(o)]]);
    o.children.forEach(visit);
  };
  roots.forEach(visit);
  return JSON.stringify([
    settings,
    values.sort((a, b) => a[0].localeCompare(b[0])),
  ]);
}
