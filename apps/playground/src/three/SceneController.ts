import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  AxesHelper,
  Box3,
  CineonToneMapping,
  Color,
  Euler,
  FogExp2,
  GridHelper,
  type Light,
  LineBasicMaterial,
  LinearToneMapping,
  Mesh,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  ReinhardToneMapping,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { disposeTrees } from "./resources";
import { restoreGLBMetadata } from "../../../../src/contract";
import {
  createAsset,
  restoreHelpers,
  type AssetSpec,
  postFXSettings,
  activeCameraId,
  sceneRegistry,
  wrapAsBakerCamera,
  wrapAsBakerLight,
} from "shared";
import { makeGammaPass } from "./postfx/GammaPass";
import { makeHueSatPass } from "./postfx/HueSatPass";
import { makeLensDistortionPass } from "./postfx/LensDistortionPass";
import type { SceneObj } from "./types";

// Classic Cornell box dims: 10×10×10 unit room centered at (0, 5, 0)
export const ROOM = 10;

const TONE_MAP_LOOKUP = {
  none: NoToneMapping,
  linear: LinearToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
} as const;

export type TransformSnap = { pos: Vector3; rot: Euler; scale: Vector3 };

export type SceneControllerHooks = {
  onSceneChanged: (meshes: SceneObj[]) => void;

  onBeforeReplace: () => void;

  onStaleChange?: () => void;

  onViewportPick?: (id: string | null) => void;

  onTransformChange?: (
    obj: Object3D,
    before: TransformSnap,
    after: TransformSnap,
  ) => void;
};

export class SceneController {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  scene: Scene;
  controls: OrbitControls;

  lightTransformController: TransformControls;
  lightTransformHelper: Object3D;

  gridHelper: GridHelper;

  axesHelper: AxesHelper;

  cornellRoot: Object3D | null = null;
  get meshes(): SceneObj[] {
    const meshes: SceneObj[] = [];
    this.cornellRoot?.traverse((o) => {
      if (o instanceof Mesh && !o.userData.editorOnly && !o.userData.lightGizmo)
        meshes.push(o as SceneObj);
    });
    return meshes;
  }

  // ── Post-FX composer (lazy; built on first enabled-render) ──────────────────
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bloom2Pass: UnrealBloomPass | null = null;
  private fxaaPass: ShaderPass | null = null;
  private vignettePass: ShaderPass | null = null;
  private hueSatPass: ShaderPass | null = null;
  private gammaPass: ShaderPass | null = null;
  private lensDistortionPass: ShaderPass | null = null;
  private fogObject: FogExp2 | null = null;

  private _preDragSnap: TransformSnap | null = null;
  private gizmoGesture = false;
  private disposed = false;

  constructor(private hooks: SceneControllerHooks) {
    this.scene = new Scene();
    this.scene.background = new Color(0x0a0a0a);

    this.camera = new PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 5, 18);
    this.camera.lookAt(0, 5, 0);

    // preserveDrawingBuffer=true when running under Playwright (`?test=1`) so
    // `sampleCanvasPixel` readback works regardless of browser composite timing.
    const isTest =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("test") === "1";
    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: "low-power",
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: isTest,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 5, 0);
    this.controls.update();

    // Editor helpers - ground grid + world axes at origin. Tagged
    // `lightmapIgnore` so the baker's BVH/material walks skip them; also
    // drawn with depthWrite off so they don't z-fight the Cornell floor.
    this.gridHelper = new GridHelper(40, 40, 0x555555, 0x2a2a2a);
    this.gridHelper.position.y = 0.001;
    this.gridHelper.userData.lightmapIgnore = true;
    const gridMat = this.gridHelper.material as
      LineBasicMaterial | LineBasicMaterial[];
    if (Array.isArray(gridMat)) {
      for (const m of gridMat) {
        m.transparent = true;
        m.opacity = 0.5;
        m.depthWrite = false;
      }
    } else {
      gridMat.transparent = true;
      gridMat.opacity = 0.5;
      gridMat.depthWrite = false;
    }
    this.scene.add(this.gridHelper);

    this.axesHelper = new AxesHelper(2);
    this.axesHelper.position.y = 0.002;
    this.axesHelper.userData.lightmapIgnore = true;
    const axesMat = this.axesHelper.material as LineBasicMaterial;
    axesMat.depthTest = false;
    axesMat.transparent = true;
    this.axesHelper.renderOrder = 999;
    this.scene.add(this.axesHelper);

    // RectAreaLight needs its uniforms LUT initialised once before any scene
    // using it is rendered. Safe to call multiple times - LUT is cached.
    RectAreaLightUniformsLib.init();

    this.lightTransformController = new TransformControls(
      this.camera,
      this.renderer.domElement,
    );
    this.lightTransformController.addEventListener("objectChange", () => {
      this.gizmoGesture = true;
    });
    this.lightTransformHelper = this.lightTransformController.getHelper();
    this.lightTransformController.addEventListener(
      "dragging-changed",
      (event) => {
        this.controls.enabled = !event.value;
        if (event.value) {
          // Capture pre-drag snapshot for undo/redo.
          const target = this.lightTransformController.object;
          if (target) {
            this._preDragSnap = {
              pos: target.position.clone(),
              rot: target.rotation.clone(),
              scale: target.scale.clone(),
            };
          }
        } else {
          const target = this.lightTransformController.object;
          if (target && this._preDragSnap) {
            const before = this._preDragSnap;
            this._preDragSnap = null;
            const after: TransformSnap = {
              pos: target.position.clone(),
              rot: target.rotation.clone(),
              scale: target.scale.clone(),
            };
            // Only mark stale for non-light-dummy drags (light position is queried at bake time).
            this.hooks.onStaleChange?.();
            this.hooks.onTransformChange?.(target, before, after);
          }
        }
      },
    );
    // Gizmo starts detached. Selection drives attachment via attachGizmoTo.
    this.scene.add(this.lightTransformHelper);
    this.lightTransformHelper.visible = false;
    this.lightTransformController.enabled = false;

    // Viewport click → raycast pick → notify orchestrator. We track pointerdown
    // coords and only fire a pick on pointerup at (roughly) the same coords, so
    // OrbitControls drags do not steal selection.
    let downX = 0;
    let downY = 0;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      this.gizmoGesture = false;
      downX = e.clientX;
      downY = e.clientY;
    });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (this.gizmoGesture) {
        this.gizmoGesture = false;
        return;
      }
      if (e.button !== 0) return; // left-click only
      if (this.lightTransformController.dragging) return;
      if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3)
        return;
      const id = this.pickAt(e.clientX, e.clientY);
      this.hooks.onViewportPick?.(id);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Selection + gizmo + tree
  // ──────────────────────────────────────────────────────────────────────────
  private raycaster = new Raycaster();
  private pointer = new Vector2();

  pickAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Generous threshold so thin line helpers (Spot cone, Sun plane, Area rect)
    // are easy to hit. Default is 1; bump to make them grab-friendly.
    if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = 0.2;
    const lightGroups = this.scene.children.filter(
      (c) => c.userData?.bakerLightType,
    );
    const cameraGroups = this.scene.children.filter(
      (c) => c.userData?.bakerCameraType,
    );
    const targets: Object3D[] = [
      ...this.meshes,
      ...lightGroups,
      ...cameraGroups,
    ];
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    // Walk parents up the closest hit until we find either a bake mesh or the
    // light group that owns the helper/bulb that was clicked.
    const meshIds = new Set(this.meshes.map((m) => m.uuid));
    const closestHit = hits.find((hit) => {
      let o: Object3D | null = hit.object;
      while (o) {
        if (!o.visible) return false;
        o = o.parent;
      }
      return true;
    });
    if (!closestHit) return null;
    let obj: Object3D | null = closestHit.object;
    while (obj) {
      if (obj.userData?.bakerLightType || obj.userData?.bakerCameraType)
        return obj.uuid;
      if (meshIds.has(obj.uuid)) return obj.uuid;
      obj = obj.parent;
    }
    return null;
  }

  lookupObject(id: string | null): Object3D | null {
    if (!id) return null;
    const mesh = this.meshes.find((m) => m.uuid === id);
    if (mesh) return mesh;
    // All lights (default area + asset-library) and cameras live as direct
    // scene children with `userData.bakerLightType` or `bakerCameraType` set.
    return (
      this.scene.children.find(
        (o) =>
          o.uuid === id &&
          (o.userData?.bakerLightType || o.userData?.bakerCameraType),
      ) ?? null
    );
  }

  attachGizmoTo(obj: Object3D | null): void {
    this.lightTransformController.enabled = !!obj;
    if (obj) {
      this.lightTransformController.attach(obj);
      this.lightTransformHelper.visible = true;
    } else {
      this.lightTransformController.detach();
      this.lightTransformHelper.visible = false;
    }
  }

  setGizmoMode(mode: "translate" | "rotate" | "scale"): void {
    this.lightTransformController.setMode(mode);
  }

  buildSceneTree(): {
    id: string;
    name: string;
    kind: "mesh" | "light" | "camera";
    visible: boolean;
  }[] {
    const tree: {
      id: string;
      name: string;
      kind: "mesh" | "light" | "camera";
      visible: boolean;
    }[] = [];
    for (const m of this.meshes) {
      tree.push({
        id: m.uuid,
        name: m.name || `Mesh (${m.geometry.type.replace("Geometry", "")})`,
        kind: "mesh",
        visible: m.visible,
      });
    }
    // All lights (default area + asset-library Point / Spot / Sun / Area) and
    // cameras - top-level scene children carrying `userData.bakerLightType` or
    // `userData.bakerCameraType`.
    for (const child of this.scene.children) {
      if (child.userData?.bakerLightType) {
        tree.push({
          id: child.uuid,
          name: child.name || "Light",
          kind: "light",
          visible: child.visible,
        });
      } else if (child.userData?.bakerCameraType) {
        tree.push({
          id: child.uuid,
          name: child.name || "Camera",
          kind: "camera",
          visible: child.visible,
        });
      }
    }
    return tree;
  }

  setVisible(id: string, visible: boolean): void {
    const obj = this.lookupObject(id);
    if (obj) obj.visible = visible;
  }

  async importGLB(file: File): Promise<ReturnType<typeof restoreGLBMetadata>> {
    const buffer = await file.arrayBuffer();
    return this.importGLBBuffer(buffer);
  }

  async importGLBBuffer(
    buffer: ArrayBuffer,
  ): Promise<ReturnType<typeof restoreGLBMetadata>> {
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    let metadata: ReturnType<typeof restoreGLBMetadata>;
    try {
      metadata = restoreGLBMetadata(gltf.scene);
    } catch (error) {
      disposeTrees([gltf.scene]);
      throw error;
    }
    if (this.disposed) {
      disposeTrees([gltf.scene]);
      throw new Error("Studio closed during import");
    }
    this.replaceContent(gltf.scene);
    this.fitCameraAndLightToScene();
    return metadata;
  }

  fitCameraAndLightToScene(): void {
    const box = new Box3();
    for (const m of this.meshes) box.expandByObject(m);
    if (box.isEmpty()) return;

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    this.camera.position.set(center.x, center.y, center.z + maxDim * 2.5);
    this.controls.target.copy(center);
    this.controls.update();
  }

  updateSize(): void {
    const w = Math.max(
      1,
      this.renderer.domElement.parentElement?.clientWidth ?? window.innerWidth,
    );
    const h = Math.max(
      1,
      this.renderer.domElement.parentElement?.clientHeight ??
        window.innerHeight,
    );
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // If we have an active camera locked or being viewed through, the
    // CornellBoxExample tick loop will handle the property sync.

    if (this.composer) {
      this.composer.setSize(w, h);
      this.bloomPass?.setSize(w, h);
      this.bloom2Pass?.setSize(w, h);
      this.ssaoPass?.setSize(w, h);
      if (this.fxaaPass) {
        const dpr = this.renderer.getPixelRatio();
        const res = this.fxaaPass.material.uniforms.resolution;
        if (res) res.value.set(1 / (w * dpr), 1 / (h * dpr));
      }
    }
  }

  private ensureComposer(): EffectComposer {
    if (this.composer) return this.composer;
    const w = Math.max(
      1,
      this.renderer.domElement.parentElement?.clientWidth ?? window.innerWidth,
    );
    const h = Math.max(
      1,
      this.renderer.domElement.parentElement?.clientHeight ??
        window.innerHeight,
    );
    const composer = new EffectComposer(this.renderer);
    composer.setSize(w, h);

    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);

    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
    this.ssaoPass.kernelRadius = 0.2;
    this.ssaoPass.minDistance = 0.005;
    this.ssaoPass.maxDistance = 0.1;
    composer.addPass(this.ssaoPass);

    this.bloomPass = new UnrealBloomPass(new Vector2(w, h), 0.35, 0.4, 0.85);
    composer.addPass(this.bloomPass);

    // ESL-style secondary bloom: bigger kernel, lower threshold → soft global
    // glow that stacks on top of the primary bloom.
    this.bloom2Pass = new UnrealBloomPass(new Vector2(w, h), 0.25, 0.85, 0.3);
    composer.addPass(this.bloom2Pass);
    // Render targets stay linear; apply the chosen tone mapping/exposure before display effects.
    composer.addPass(new OutputPass());

    this.hueSatPass = makeHueSatPass();
    composer.addPass(this.hueSatPass);

    // Vignette runs after bloom so the corner darkening isn't blown out by
    // bloom-bright pixels. `offset` is fixed at the shader default (1.0) and
    // `darkness` is driven by `vignetteStrength` in syncPostFX.
    this.vignettePass = new ShaderPass(VignetteShader);
    composer.addPass(this.vignettePass);

    this.gammaPass = makeGammaPass();
    composer.addPass(this.gammaPass);

    this.lensDistortionPass = makeLensDistortionPass();
    composer.addPass(this.lensDistortionPass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    const dpr = this.renderer.getPixelRatio();
    const res = this.fxaaPass.material.uniforms.resolution;
    if (res) res.value.set(1 / (w * dpr), 1 / (h * dpr));
    composer.addPass(this.fxaaPass);

    this.composer = composer;
    return composer;
  }

  private syncPostFX(): void {
    const s = postFXSettings.value;
    // Tone mapping + exposure are RENDERER-level - not post-fx passes. They
    // configure the scene's color pipeline whether or not the composer chain
    // is active. Gating them behind `master` broke the dropdown/slider for
    // users in bake-QA mode.
    this.renderer.toneMapping = TONE_MAP_LOOKUP[s.toneMapping] ?? NoToneMapping;
    this.renderer.toneMappingExposure = s.exposure;

    // ESL env enable runs whether or not the composer exists - it touches
    // scene-level state, not composer passes.

    // Fog is renderer-global. Toggling it forces a one-frame material recompile
    // (USE_FOG define add/remove) which can flash black; that's inherent.
    if (s.master && s.fogEnabled) {
      if (!this.fogObject)
        this.fogObject = new FogExp2(s.fogColor, s.fogDensity);
      this.fogObject.color.setHex(s.fogColor);
      this.fogObject.density = s.fogDensity;
      this.scene.fog = this.fogObject;
    } else {
      // Always clear when not active - covers the toggle-off case even when
      // a non-ESL preset never set our fogObject.
      this.scene.fog = null;
    }

    if (!this.composer) return;
    if (this.ssaoPass) {
      this.ssaoPass.enabled = s.master && s.ssaoEnabled;
      this.ssaoPass.kernelRadius = s.ssaoRadius;
      this.ssaoPass.minDistance = 0.005;
      this.ssaoPass.maxDistance = s.ssaoDistance;
    }
    if (this.bloomPass) {
      this.bloomPass.enabled = s.master && s.bloomEnabled;
      this.bloomPass.strength = s.bloomStrength;
      this.bloomPass.radius = s.bloomRadius;
      this.bloomPass.threshold = s.bloomThreshold;
    }
    if (this.bloom2Pass) {
      this.bloom2Pass.enabled = s.master && s.bloom2Enabled;
      this.bloom2Pass.strength = s.bloom2Strength;
      this.bloom2Pass.radius = s.bloom2Radius;
      this.bloom2Pass.threshold = s.bloom2Threshold;
    }
    if (this.hueSatPass) {
      this.hueSatPass.enabled = s.master && s.hueSatEnabled;
      const u = this.hueSatPass.material.uniforms;
      if (u.hue) u.hue.value = s.hue;
      if (u.saturation) u.saturation.value = s.saturation;
    }
    if (this.vignettePass) {
      this.vignettePass.enabled = s.master && s.vignetteEnabled;
      const darkness = this.vignettePass.material.uniforms.darkness;
      if (darkness) darkness.value = s.vignetteStrength;
    }
    if (this.gammaPass) {
      this.gammaPass.enabled = s.master && Math.abs(s.gamma - 1) > 1e-3;
      const u = this.gammaPass.material.uniforms;
      if (u.gamma) u.gamma.value = s.gamma;
    }
    if (this.lensDistortionPass) {
      this.lensDistortionPass.enabled = s.master && s.lensDistortionEnabled;
      const u = this.lensDistortionPass.material.uniforms;
      if (u.baseIor) u.baseIor.value = s.baseIor;
      if (u.bandOffset) u.bandOffset.value = s.bandOffset;
      if (u.jitterIntensity) u.jitterIntensity.value = s.jitterIntensity;
    }
  }

  renderFrame(): void {
    if (postFXSettings.value.master) this.ensureComposer();
    this.syncPostFX();
    const s = postFXSettings.value;
    const portalCamId = activeCameraId.value;
    const portalCamObj = portalCamId ? this.lookupObject(portalCamId) : null;
    const portalCam = portalCamObj?.children.find(
      (c) => (c as PerspectiveCamera).isPerspectiveCamera,
    ) as PerspectiveCamera | undefined;

    const w = Math.max(
      1,
      this.renderer.domElement.parentElement?.clientWidth ?? window.innerWidth,
    );
    const h = Math.max(
      1,
      this.renderer.domElement.parentElement?.clientHeight ??
        window.innerHeight,
    );

    if (portalCam) {
      // Calculate portal rect centered on canvas
      const canvasAspect = w / h;
      const camAspect = portalCam.aspect;

      let pw, ph;
      if (camAspect > canvasAspect) {
        pw = w;
        ph = w / camAspect;
      } else {
        ph = h;
        pw = h * camAspect;
      }

      const px = (w - pw) / 2;
      const py = (h - ph) / 2;

      const renderer = this.renderer;
      const prevViewport = renderer.getViewport(new Vector4());
      const prevScissor = renderer.getScissor(new Vector4());
      const prevScissorTest = renderer.getScissorTest();
      const prevClearColor = new Color();
      renderer.getClearColor(prevClearColor);
      const prevClearAlpha = renderer.getClearAlpha();

      try {
        // Clear background with dark grey (Blender-style)
        renderer.setClearColor(0x1a1a1a, 1);
        renderer.setRenderTarget(null);
        renderer.clear();

        // Set viewport and scissor to the portal rect
        renderer.setViewport(px, py, pw, ph);
        renderer.setScissor(px, py, pw, ph);
        renderer.setScissorTest(true);

        if (s.master) {
          this.ensureComposer().render();
        } else {
          renderer.render(this.scene, this.camera);
        }
      } finally {
        renderer.setViewport(prevViewport);
        renderer.setScissor(prevScissor);
        renderer.setScissorTest(prevScissorTest);
        renderer.setClearColor(prevClearColor, prevClearAlpha);
      }
    } else {
      const canvasAspect = w / h;
      if (Math.abs(this.camera.aspect - canvasAspect) > 0.01) {
        this.camera.aspect = canvasAspect;
        this.camera.updateProjectionMatrix();
      }
      if (s.master) {
        this.ensureComposer().render();
      } else {
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Camera views (Blender-style numpad shortcuts).
  // ──────────────────────────────────────────────────────────────────────────

  private sceneBoundsOrFallback(): { center: Vector3; size: number } {
    const box = new Box3();
    for (const m of this.meshes) box.expandByObject(m);
    if (box.isEmpty()) return { center: new Vector3(0, 5, 0), size: 10 };
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    return { center, size: Math.max(size.x, size.y, size.z) || 10 };
  }

  setView(
    view: "front" | "right" | "top" | "persp" | "back" | "left" | "bottom",
  ): void {
    const { center, size } = this.sceneBoundsOrFallback();
    const d = size * 1.8;
    const pos = new Vector3();
    switch (view) {
      case "front":
        pos.set(center.x, center.y, center.z + d);
        break;
      case "back":
        pos.set(center.x, center.y, center.z - d);
        break;
      case "right":
        pos.set(center.x + d, center.y, center.z);
        break;
      case "left":
        pos.set(center.x - d, center.y, center.z);
        break;
      case "top":
        pos.set(center.x, center.y + d, center.z + 0.001); // tiny z offset avoids gimbal lock
        break;
      case "bottom":
        pos.set(center.x, center.y - d, center.z + 0.001);
        break;
      case "persp":
      default:
        pos.set(center.x + d * 0.7, center.y + d * 0.5, center.z + d * 0.8);
        break;
    }
    this.camera.position.copy(pos);
    this.controls.target.copy(center);
    this.controls.update();
  }

  frameObject(obj: Object3D): void {
    const box = new Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    const dist = Math.max(size * 1.4, 1);
    const dir = new Vector3();
    this.camera.getWorldDirection(dir).negate(); // away from look-at
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.update();
  }

  snapViewportToCamera(id: string): void {
    const obj = this.lookupObject(id);
    if (!obj || !obj.userData?.bakerCameraType) return;

    // The camera is the first child of the group
    const cam = obj.children.find(
      (c) => (c as PerspectiveCamera).isPerspectiveCamera,
    ) as PerspectiveCamera | undefined;
    if (!cam) return;

    // We want to match the camera's WORLD position and rotation.
    const wp = new Vector3();
    const wq = new Quaternion();
    cam.getWorldPosition(wp);
    cam.getWorldQuaternion(wq);

    this.camera.position.copy(wp);
    this.camera.quaternion.copy(wq);

    // Update OrbitControls target to be in front of the camera
    const dir = new Vector3(0, 0, -1).applyQuaternion(wq);
    this.controls.target.copy(wp).addScaledVector(dir, 5);
    this.controls.update();
  }

  syncCameraToViewport(id: string): void {
    const obj = this.lookupObject(id);
    if (!obj || !obj.userData?.bakerCameraType) return;

    // We match the GROUP's world position/rotation to the viewport camera.
    // (Simpler than counter-transforming the camera child).
    obj.position.copy(this.camera.position);
    obj.quaternion.copy(this.camera.quaternion);

    // Ensure the helper updates immediately
    this.updateHelpers();
  }

  syncViewportToCamera(id: string): void {
    const obj = this.lookupObject(id);
    if (!obj || !obj.userData?.bakerCameraType) return;

    const cam = obj.children.find(
      (c) => (c as PerspectiveCamera).isPerspectiveCamera,
    ) as PerspectiveCamera | undefined;
    if (!cam) return;

    // Match transform
    const wp = new Vector3();
    const wq = new Quaternion();
    cam.getWorldPosition(wp);
    cam.getWorldQuaternion(wq);

    this.camera.position.copy(wp);
    this.camera.quaternion.copy(wq);

    // Match lens properties
    if (this.camera.fov !== cam.fov) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.camera.near !== cam.near) {
      this.camera.near = cam.near;
      this.camera.updateProjectionMatrix();
    }
    if (this.camera.far !== cam.far) {
      this.camera.far = cam.far;
      this.camera.updateProjectionMatrix();
    }
    // Note: aspect ratio is usually controlled by the canvas/renderer size,
    // but we copy it anyway if it differs significantly.
    if (Math.abs(this.camera.aspect - cam.aspect) > 0.01) {
      this.camera.aspect = cam.aspect;
      this.camera.updateProjectionMatrix();
    }

    // Keep controls in sync
    const dir = new Vector3(0, 0, -1).applyQuaternion(wq);
    this.controls.target.copy(wp).addScaledVector(dir, 5);
    this.controls.update();
  }

  setCameraFov(deg: number): void {
    this.camera.fov = Math.max(1, Math.min(170, deg));
    this.camera.updateProjectionMatrix();
  }

  private detached = new Set<Object3D>();
  private historyOwners = new Map<Object3D, number>();
  retainHistoryNode(node: Object3D): void {
    this.historyOwners.set(node, (this.historyOwners.get(node) ?? 0) + 1);
  }
  releaseHistoryNode(node: Object3D): void {
    const owners = (this.historyOwners.get(node) ?? 1) - 1;
    if (owners > 0) this.historyOwners.set(node, owners);
    else {
      this.historyOwners.delete(node);
      if (!node.parent) this.disposeDetachedNode(node);
    }
  }
  private disposeCornellRoot(): void {
    this.attachGizmoTo(null);
    const roots = this.scene.children.filter(
      (o) =>
        o === this.cornellRoot ||
        o.userData.bakerLightType ||
        o.userData.bakerCameraType,
    );
    for (const root of roots) this.scene.remove(root);
    disposeTrees([...roots, ...this.detached]);
    this.detached.clear();
    this.cornellRoot = null;
  }

  dispose(): void {
    this.disposed = true;
    this.disposeCornellRoot();
    this.controls.dispose();
    this.scene.remove(this.lightTransformHelper);
    this.lightTransformController.dispose();
    for (const pass of this.composer?.passes ?? []) pass.dispose?.();
    this.composer?.dispose();
    disposeTrees([this.scene]);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  T-D7 - Asset Library: drag-drop add, delete, ground-plane pick
  // ──────────────────────────────────────────────────────────────────────────

  private groundPlane = new Plane(new Vector3(0, 1, 0), 0);

  pickGroundPoint(clientX: number, clientY: number): Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!ok) return new Vector3(0, 0, 0);
    return hit;
  }

  addAsset(spec: AssetSpec, worldPos: Vector3): string {
    const node = createAsset(spec);
    if (!node) {
      console.warn("[baker] addAsset: unknown or disabled asset spec", spec);
      return "";
    }
    node.userData.assetSpec = { ...spec };
    node.position.copy(worldPos);

    if (spec.kind === "primitive") {
      if (!this.cornellRoot) {
        this.cornellRoot = new Object3D();
        this.scene.add(this.cornellRoot);
      }
      const mesh = node as Mesh;
      // Lift primitive so its bottom rests on ground (best-effort for unit shapes).
      if (spec.id !== "plane") node.position.y = Math.max(node.position.y, 0.5);
      this.cornellRoot.add(mesh);
    } else {
      // Asset-library lights and cameras are Group objects bundling Light/Camera
      // + Target + Helper. Parented directly to the scene so they survive
      // cornellRoot tear-downs on preset swaps and dispose with the scene.
      this.scene.add(node);
      // Lift to the scene's vertical mid-line so assets don't sit on the floor
      // and scale with the environment (a 100m scene needs more headroom than
      // a 1m one). Falls back to 2 when the scene is empty.
      const { center, size } = this.sceneBoundsOrFallback();
      const lift = Math.max(center.y, size * 0.2);
      node.position.y = Math.max(node.position.y, lift);
    }

    this.hooks.onSceneChanged(this.meshes);
    this.hooks.onStaleChange?.();
    return node.uuid;
  }

  updateHelpers(): void {
    for (const child of this.scene.children) {
      if (child.userData?.bakerLightType) {
        const helper = child.userData?.lightHelper as
          { update?: () => void } | undefined;
        helper?.update?.();
      } else if (child.userData?.bakerCameraType) {
        const helper = child.userData?.cameraHelper as
          { update?: () => void } | undefined;
        helper?.update?.();
      }
    }
  }

  removeNode(id: string): void {
    const detached = this.detachNode(id);
    if (detached) this.disposeDetachedNode(detached.node);
  }

  detachNode(
    id: string,
  ): { node: Object3D; parent: Object3D; index: number } | null {
    if (!id) return null;

    const meshIdx = this.meshes.findIndex((m) => m.uuid === id);
    if (meshIdx !== -1) {
      const mesh = this.meshes[meshIdx];
      if (!mesh) return null;
      const parent = mesh.parent;
      if (!parent) return null;
      const index = parent.children.indexOf(mesh);
      parent.remove(mesh);
      this.detached.add(mesh);
      if (this.lightTransformController.object === mesh)
        this.attachGizmoTo(null);
      this.hooks.onSceneChanged(this.meshes);
      this.hooks.onStaleChange?.();
      return { node: mesh, parent, index };
    }

    // Any direct scene child carrying `bakerLightType` or `bakerCameraType` is
    // fair game to delete - including the default area light. The user can
    // drag a fresh one in from the asset library if they want it back.
    const target = this.scene.children.find((o) => o.uuid === id);
    if (target?.userData?.bakerLightType || target?.userData?.bakerCameraType) {
      const index = this.scene.children.indexOf(target);
      this.scene.remove(target);
      this.detached.add(target);
      // If we just removed what the gizmo was attached to, detach so the
      // transform widget doesn't dangle on a freed object.
      if (this.lightTransformController.object === target) {
        this.lightTransformController.detach();
        this.lightTransformHelper.visible = false;
        this.lightTransformController.enabled = false;
      }
      this.hooks.onSceneChanged(this.meshes);
      this.hooks.onStaleChange?.();
      return { node: target, parent: this.scene, index };
    }
    return null;
  }

  attachNode(
    node: Object3D,
    parent: Object3D,
    index = parent.children.length,
  ): void {
    this.detached.delete(node);
    parent.add(node);
    parent.children.splice(parent.children.indexOf(node), 1);
    parent.children.splice(Math.min(index, parent.children.length), 0, node);
    this.hooks.onSceneChanged(this.meshes);
    this.hooks.onStaleChange?.();
  }

  disposeDetachedNode(node: Object3D): void {
    this.detached.delete(node);
    disposeTrees([node], [this.scene, ...this.detached]);
  }

  getCornellRoot(): Object3D | null {
    return this.cornellRoot;
  }

  async loadPresetById(
    presetId: string,
  ): Promise<import("shared").SceneBuildResult> {
    const preset = sceneRegistry.get(presetId);
    if (!preset) throw new Error("Unknown scene: " + presetId);
    const root = new Object3D();
    root.name = "preset:" + presetId;
    let result: import("shared").SceneBuildResult;
    try {
      result = await preset.build(root);
    } catch (error) {
      disposeTrees([root]);
      throw error;
    }
    if (this.disposed) {
      disposeTrees([root]);
      throw new Error("Studio closed during scene load");
    }
    this.replaceContent(root);
    const hasLights = this.scene.children.some(
      (c) => c.userData.bakerLightType,
    );
    if (!hasLights && !result.disableFallbackLight) {
      const light = createAsset({ kind: "light", id: "area" })!;
      light.name = "Ceiling Area Light";
      light.position.fromArray(
        result.lightDummy?.position ?? [0, ROOM - 0.01, 0],
      );
      light.rotation.x = -Math.PI / 2;
      this.scene.add(light);
    }
    this.scene.background = new Color(result.background ?? 0x17191d);
    this.camera.near = 0.1;
    this.camera.far = 1000;
    if (result.camera) {
      this.camera.position.fromArray(result.camera.position);
      this.controls.target.fromArray(result.camera.target);
      this.camera.fov = result.camera.fov ?? 50;
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
    this.hooks.onSceneChanged(this.meshes);
    return result;
  }

  replaceContent(root: Object3D): void {
    this.hooks.onBeforeReplace();
    this.disposeCornellRoot();
    this.cornellRoot = root;
    this.scene.add(root);
    root.updateMatrixWorld(true);
    this.hoistRawLights(root);
    this.hoistRawCameras(root);
    for (const group of this.scene.children)
      if (group.userData.bakerLightType || group.userData.bakerCameraType)
        restoreHelpers(group);
    // A material edit belongs to its selected mesh, even if a preset shared material instances.
    const originalMaterials = new Set<import("three").Material>();
    root.traverse((obj) => {
      if (obj instanceof Mesh && !obj.userData.editorOnly) {
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        materials.forEach((m) => originalMaterials.add(m));
        obj.material = Array.isArray(obj.material)
          ? materials.map((m) => m.clone())
          : materials[0]!.clone();
      }
    });
    originalMaterials.forEach((m) => m.dispose());
    this.hooks.onSceneChanged(this.meshes);
  }

  private hoistRawLights(root: Object3D): void {
    const orphans: { light: Light; ancestor: Object3D | null }[] = [];
    root.traverse((obj) => {
      if (!(obj as Light).isLight || obj.userData.editorOnly) return;
      // Skip if already inside a baker group.
      let p: Object3D | null = obj.parent;
      while (p) {
        if (p.userData?.bakerLightType) return;
        p = p.parent;
      }
      orphans.push({ light: obj as Light, ancestor: obj.parent });
    });
    const wrapped: Object3D[] = [];
    root.traverse((o) => {
      if (o.userData.bakerLightType || o.userData.bakerCameraType)
        wrapped.push(o);
    });
    for (const o of wrapped) this.scene.attach(o);
    for (const { light } of orphans) {
      const group = wrapAsBakerLight(light);
      this.scene.add(group);
    }
  }

  private hoistRawCameras(root: Object3D): void {
    const orphans: PerspectiveCamera[] = [];
    root.traverse((obj) => {
      if (!(obj as PerspectiveCamera).isPerspectiveCamera) return;
      // Skip the main viewport camera if it somehow got in there (unlikely)
      if (obj === this.camera) return;

      // Skip if already inside a baker group.
      let p: Object3D | null = obj.parent;
      while (p) {
        if (p.userData?.bakerCameraType) return;
        p = p.parent;
      }
      orphans.push(obj as PerspectiveCamera);
    });
    for (const cam of orphans) {
      const group = wrapAsBakerCamera(cam);
      this.scene.add(group);
    }
  }
}
