import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  Color,
  DoubleSide,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RectAreaLight,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type EditorNodeKind = 'mesh' | 'light';

export interface EditorNode {
  id: string;
  name: string;
  kind: EditorNodeKind;
  visible: boolean;
}

export interface ExportSettings {
  world: {
    color: string;
    intensity: number;
  };
  bake: {
    resolution: number;
    samples: number;
    bounces: number;
    denoise: boolean;
  };
}

interface EditorCallbacks {
  onChange: () => void;
  onSelectionChange: (id: string | null) => void;
}

type AreaLightMetadata = {
  type: 'area';
  color: string;
  intensity: number;
  width: number;
  height: number;
};

const ROOM_WIDTH = 8;
const ROOM_HEIGHT = 6;
const ROOM_DEPTH = 8;
const WALL = 0.12;

export class SceneEditor {
  readonly scene = new Scene();
  readonly content = new Group();
  readonly camera = new PerspectiveCamera(46, 1, 0.1, 100);
  readonly renderer: WebGLRenderer;
  readonly orbit: OrbitControls;
  readonly transform: TransformControls;

  private readonly callbacks: EditorCallbacks;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly transformHelper: Object3D;
  private selectedId: string | null = null;
  private animationFrame = 0;
  private pointerDown = { x: 0, y: 0 };

  constructor(private readonly host: HTMLElement, callbacks: EditorCallbacks) {
    this.callbacks = callbacks;
    this.scene.name = 'LightBaker Scene';
    this.content.name = 'Scene';
    this.scene.add(this.content);
    this.scene.background = new Color('#17191d');

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.host.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 3.2, 13.5);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 2.8, 0);
    this.orbit.enableDamping = true;
    this.orbit.update();

    const grid = new GridHelper(24, 24, 0x58616e, 0x30353d);
    grid.position.y = 0.005;
    this.scene.add(grid);
    this.scene.add(new AmbientLight(0xffffff, 0.08));

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);
    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
      if (!event.value) this.changed();
    });
    this.transform.addEventListener('objectChange', () => this.callbacks.onChange());

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);

    RectAreaLightUniformsLib.init();
    this.resetCornellScene();
    this.resize();
    this.animate();
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || this.transform.dragging) return;
    if (
      Math.abs(event.clientX - this.pointerDown.x) > 3 ||
      Math.abs(event.clientY - this.pointerDown.y) > 3
    )
      return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    const picked = hits.find((hit) => !hit.object.userData.editorOnly)?.object ?? null;
    this.select(picked ? this.selectableAncestor(picked) : null);
  };

  private selectableAncestor(object: Object3D): Object3D {
    let current = object;
    while (current.parent && current.parent !== this.content) current = current.parent;
    return current;
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private changed(): void {
    this.syncAreaLightMetadata();
    this.callbacks.onChange();
  }

  resetCornellScene(): void {
    this.transform.detach();
    this.selectedId = null;
    for (const child of [...this.content.children]) this.content.remove(child);

    const material = (color: number): MeshStandardMaterial =>
      new MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 });
    const addBox = (
      name: string,
      size: [number, number, number],
      position: [number, number, number],
      color: number,
      rotationY = 0,
    ): Mesh => {
      const mesh = new Mesh(new BoxGeometry(...size), material(color));
      mesh.name = name;
      mesh.position.set(...position);
      mesh.rotation.y = rotationY;
      this.content.add(mesh);
      return mesh;
    };

    addBox('Floor', [ROOM_WIDTH, WALL, ROOM_DEPTH], [0, -WALL / 2, 0], 0xe8e4dc);
    addBox(
      'Ceiling',
      [ROOM_WIDTH, WALL, ROOM_DEPTH],
      [0, ROOM_HEIGHT + WALL / 2, 0],
      0xe8e4dc,
    );
    addBox(
      'Back Wall',
      [ROOM_WIDTH, ROOM_HEIGHT, WALL],
      [0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2 - WALL / 2],
      0xe8e4dc,
    );
    addBox(
      'Left Wall',
      [WALL, ROOM_HEIGHT, ROOM_DEPTH],
      [-ROOM_WIDTH / 2 - WALL / 2, ROOM_HEIGHT / 2, 0],
      0xb63a32,
    );
    addBox(
      'Right Wall',
      [WALL, ROOM_HEIGHT, ROOM_DEPTH],
      [ROOM_WIDTH / 2 + WALL / 2, ROOM_HEIGHT / 2, 0],
      0x2c7b57,
    );
    addBox('Tall Block', [2, 3.6, 2], [-1.4, 1.8, -1.1], 0xd7d2c8, 0.28);
    addBox('Short Block', [2.2, 1.8, 2.2], [1.45, 0.9, 1.15], 0xd7d2c8, -0.34);

    const lightGroup = new Group();
    lightGroup.name = 'Ceiling Area Light';
    lightGroup.userData.bakerLightType = 'area';
    lightGroup.position.set(0, ROOM_HEIGHT - 0.2, 0.15);

    const light = new RectAreaLight(0xfff1d1, 14, 2.4, 2.0);
    light.rotation.x = -Math.PI / 2;
    light.name = 'Area Light Source';
    lightGroup.add(light);

    const panel = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xfff4d6, side: DoubleSide, toneMapped: false }),
    );
    panel.name = 'Area Light Panel';
    panel.rotation.x = -Math.PI / 2;
    panel.scale.set(light.width, light.height, 1);
    panel.userData.editorOnly = true;
    lightGroup.add(panel);

    const helper = new RectAreaLightHelper(light, 0xffd37a);
    helper.userData.editorOnly = true;
    light.add(helper);
    this.content.add(lightGroup);
    this.syncAreaLightMetadata();

    this.camera.position.set(0, 3.25, 13.5);
    this.orbit.target.set(0, 2.8, 0);
    this.orbit.update();
    this.callbacks.onSelectionChange(null);
    this.callbacks.onChange();
  }

  nodes(): EditorNode[] {
    return this.content.children.map((object) => ({
      id: object.uuid,
      name: object.name || 'Untitled',
      kind: object.userData.bakerLightType ? 'light' : 'mesh',
      visible: object.visible,
    }));
  }

  get selected(): Object3D | null {
    return this.selectedId ? this.content.getObjectByProperty('uuid', this.selectedId) ?? null : null;
  }

  selectById(id: string): void {
    this.select(this.content.getObjectByProperty('uuid', id) ?? null);
  }

  private select(object: Object3D | null): void {
    this.selectedId = object?.uuid ?? null;
    if (object) {
      this.transform.attach(object);
      this.transformHelper.visible = true;
    } else {
      this.transform.detach();
      this.transformHelper.visible = false;
    }
    this.callbacks.onSelectionChange(this.selectedId);
    this.callbacks.onChange();
  }

  setTransformMode(mode: TransformMode): void {
    this.transform.setMode(mode);
  }

  frameSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    selected.getWorldPosition(this.orbit.target);
    this.camera.position.copy(this.orbit.target).add({ x: 5, y: 3.5, z: 7 });
    this.orbit.update();
  }

  setVisible(id: string, visible: boolean): void {
    const object = this.content.getObjectByProperty('uuid', id);
    if (!object) return;
    object.visible = visible;
    this.changed();
  }

  setWorldColor(color: string): void {
    this.scene.background = new Color(color);
    this.callbacks.onChange();
  }

  updateSelectedTransform(axis: 'x' | 'y' | 'z', value: number, channel: 'position' | 'rotation' | 'scale'): void {
    const object = this.selected;
    if (!object || !Number.isFinite(value)) return;
    object[channel][axis] = value;
    object.updateMatrixWorld(true);
    this.changed();
  }

  updateSelectedMaterial(values: { color?: string; roughness?: number; metalness?: number }): void {
    const object = this.selected;
    if (!(object instanceof Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!(material instanceof MeshStandardMaterial)) return;
    if (values.color) material.color.set(values.color);
    if (values.roughness !== undefined) material.roughness = values.roughness;
    if (values.metalness !== undefined) material.metalness = values.metalness;
    material.needsUpdate = true;
    this.changed();
  }

  getSelectedMaterial(): MeshStandardMaterial | null {
    const object = this.selected;
    if (!(object instanceof Mesh)) return null;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    return material instanceof MeshStandardMaterial ? material : null;
  }

  getSelectedAreaLight(): RectAreaLight | null {
    const object = this.selected;
    if (!object?.userData.bakerLightType) return null;
    return object.children.find((child) => child instanceof RectAreaLight) as RectAreaLight | null;
  }

  updateSelectedAreaLight(values: {
    color?: string;
    intensity?: number;
    width?: number;
    height?: number;
  }): void {
    const light = this.getSelectedAreaLight();
    if (!light) return;
    if (values.color) light.color.set(values.color);
    if (values.intensity !== undefined) light.intensity = values.intensity;
    if (values.width !== undefined) light.width = values.width;
    if (values.height !== undefined) light.height = values.height;
    const panel = light.parent?.children.find((child) => child.userData.editorOnly && child instanceof Mesh);
    if (panel) panel.scale.set(light.width, light.height, 1);
    const helper = light.children.find((child) => child instanceof RectAreaLightHelper);
    if (helper instanceof RectAreaLightHelper) (helper as RectAreaLightHelper & { update?: () => void }).update?.();
    this.changed();
  }

  private syncAreaLightMetadata(): void {
    this.content.traverse((object) => {
      if (object.userData.bakerLightType !== 'area') return;
      const light = object.children.find((child) => child instanceof RectAreaLight) as
        | RectAreaLight
        | undefined;
      if (!light) return;
      const metadata: AreaLightMetadata = {
        type: 'area',
        color: `#${light.color.getHexString()}`,
        intensity: light.intensity,
        width: light.width,
        height: light.height,
      };
      object.userData.lightbakerLight = metadata;
    });
  }

  async exportGLB(settings: ExportSettings): Promise<ArrayBuffer> {
    this.syncAreaLightMetadata();
    const exportScene = new Scene();
    exportScene.name = this.scene.name;
    exportScene.userData.lightbaker = { version: 1, ...settings };
    exportScene.userData.lightbakerCamera = {
      position: this.camera.position.toArray(),
      target: this.orbit.target.toArray(),
      fov: this.camera.fov,
    };

    for (const object of this.content.children) exportScene.add(object.clone(true));
    const discard: Object3D[] = [];
    exportScene.traverse((object) => {
      if (object.userData.editorOnly || 'isLight' in object) discard.push(object);
    });
    for (const object of discard) object.parent?.remove(object);

    const output = await new GLTFExporter().parseAsync(exportScene, {
      binary: true,
      onlyVisible: false,
    });
    if (!(output instanceof ArrayBuffer)) throw new Error('Could not serialize the scene as GLB.');
    return output;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.transform.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
