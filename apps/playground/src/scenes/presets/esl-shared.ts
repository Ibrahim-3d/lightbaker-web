import {
  DirectionalLight,
  Euler,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Vector2,
  Vector3,
} from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export type EslMeshTweak = {
  name: string;
  roughness?: number;
  metalness?: number;
  normalScale?: [number, number];
};

let _draco: DRACOLoader | null = null;
function getDraco(): DRACOLoader {
  if (_draco) return _draco;
  const d = new DRACOLoader();
  // Keep packaged scenes self-contained in development and production.
  d.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  _draco = d;
  return d;
}

let _gltf: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (_gltf) return _gltf;
  _gltf = new GLTFLoader();
  _gltf.setDRACOLoader(getDraco());
  return _gltf;
}

export async function loadEslGLB(url: string): Promise<GLTF> {
  const loader = getLoader();
  return new Promise<GLTF>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

export function eulerToTarget(
  pos: [number, number, number],
  euler: [number, number, number],
  distance = 5,
  fov?: number,
): {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
} {
  const e = new Euler(euler[0], euler[1], euler[2], "YXZ");
  const forward = new Vector3(0, 0, -1).applyEuler(e).normalize();
  return {
    position: pos,
    target: [
      pos[0] + forward.x * distance,
      pos[1] + forward.y * distance,
      pos[2] + forward.z * distance,
    ],
    fov,
  };
}

export function addSpawnCamera(
  root: Object3D,
  pos: [number, number, number] | Readonly<[number, number, number]>,
  euler: [number, number, number] | Readonly<[number, number, number]>,
  fov = 50,
): PerspectiveCamera {
  const cam = new PerspectiveCamera(fov, 1, 0.1, 100);
  cam.name = "Spawn Camera";
  cam.position.set(pos[0], pos[1], pos[2]);
  cam.quaternion.setFromEuler(new Euler(euler[0], euler[1], euler[2], "YXZ"));
  root.add(cam);
  return cam;
}

export function applyMeshTweaks(
  root: Object3D,
  tweaks: EslMeshTweak[],
): number {
  let applied = 0;
  for (const t of tweaks) {
    const obj = root.getObjectByName(t.name) as Mesh | undefined;
    if (!obj || !(obj as Mesh).isMesh) continue;
    const mat = (obj as Mesh).material as MeshStandardMaterial;
    if (!mat) continue;
    if (t.roughness !== undefined)
      mat.roughness = Math.min(1, Math.max(0, t.roughness));
    if (t.metalness !== undefined)
      mat.metalness = Math.min(1, Math.max(0, t.metalness));
    if (t.normalScale && mat.normalScale) {
      mat.normalScale.copy(new Vector2(t.normalScale[0], t.normalScale[1]));
    }
    mat.needsUpdate = true;
    applied++;
  }
  return applied;
}

export function normalisePBRMaterials(root: Object3D): void {
  root.traverse((obj) => {
    const m = obj as Mesh;
    if (!m.isMesh) return;
    // Enable real-time shadow casting/receiving so pre-bake solid view shows
    // directional sun shadows instead of looking flat-unlit.
    m.castShadow = true;
    m.receiveShadow = true;
    const mat = m.material as MeshStandardMaterial;
    if (!mat || Array.isArray(mat)) return;
    if (typeof mat.roughness === "number") {
      mat.roughness = Math.min(1, Math.max(0, mat.roughness));
    }
    if (typeof mat.metalness === "number") {
      mat.metalness = Math.min(1, Math.max(0, mat.metalness));
    }
    // ESL GLBs ship envMapIntensity tuned for ESL's shader patch (gym=7.77).
    // We don't have that patch, so even a faint scene.environment leaks bright
    // ambient through. Force to 0 - user can crank in WorldPage if they want.
    mat.envMapIntensity = 0;
    mat.needsUpdate = true;
  });
}

export function addSunLight(
  root: Object3D,
  direction: [number, number, number],
  intensity = 1,
  distance = 50,
): DirectionalLight {
  const sun = new DirectionalLight(0xffffff, intensity);
  sun.position.set(
    -direction[0] * distance,
    -direction[1] * distance,
    -direction[2] * distance,
  );
  // Our baker reads light direction from the world-space Z axis of the light
  // object (NOT from `target.position`). Default DirectionalLight has identity
  // rotation → always lights from +Z regardless of position. Force the rotation
  // by aiming at the origin so the baker picks up the intended direction.
  sun.lookAt(0, 0, 0);
  sun.updateMatrixWorld(true);
  sun.name = "ESL Sun";
  // Three real-time preview shadow map. Pre-bake "solid view" otherwise has
  // no occlusion → surfaces lit uniformly = scene looks unlit. Shadow map
  // gives some directional shape until the path-traced bake lands. Bake itself
  // is unaffected (it casts BVH shadow rays regardless).
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = distance * 4;
  const half = distance;
  sun.shadow.camera.left = -half;
  sun.shadow.camera.right = half;
  sun.shadow.camera.top = half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.bias = -0.0005;
  root.add(sun);
  return sun;
}

export function clearReferenceLighting(root: Object3D): void {
  const removed = new Set<import("three").Texture>();
  const retained = new Set<import("three").Texture>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    for (const mat of Array.isArray(obj.material)
      ? obj.material
      : [obj.material]) {
      if (!(mat instanceof MeshStandardMaterial)) continue;
      for (const texture of [mat.lightMap, mat.aoMap, mat.emissiveMap])
        if (texture) removed.add(texture);
      mat.lightMap = null;
      mat.aoMap = null;
      mat.emissiveMap = null;
      mat.emissive.setRGB(0, 0, 0);
      mat.emissiveIntensity = 0;
      mat.needsUpdate = true;
      for (const value of Object.values(mat))
        if (value && typeof value === "object" && "isTexture" in value)
          retained.add(value as import("three").Texture);
    }
  });
  for (const texture of removed) if (!retained.has(texture)) texture.dispose();
}

export const ESL_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/esl-demos`;

export function disposePresetLoaders(): void {
  _draco?.dispose();
  _draco = null;
  _gltf = null;
}
