import { batch, effect, signal } from "@preact/signals";
import {
  AmbientLight,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  Object3D,
  Vector3,
} from "three";
import { SceneController } from "../apps/playground/src/three/SceneController";
import { disposePresetLoaders } from "../apps/playground/src/scenes/presets/esl-shared";
import { FlyController } from "../apps/playground/src/three/FlyController";
import {
  AddCommand,
  RemoveCommand,
  TransformCommand,
} from "../apps/playground/src/three/commands";
import {
  activeCameraId,
  activeSceneId,
  bakeStatus,
  cameraFOV,
  commandHistory,
  flySpeed,
  flyActive,
  gizmoMode,
  inspectorTab,
  isStale,
  objectTick,
  postFXSettings,
  defaultPostFX,
  renderMode,
  sceneRegistry,
  sceneTree,
  selectedId,
  showAxes,
  showGrid,
  type AssetSpec,
  type Orchestrator,
} from "shared";
import {
  bakeIdentity,
  defaults,
  editableState,
  exportScene,
  exportLumenGeometry,
  lumenGeometryReadiness,
  parseProject,
  projectDocument,
  restoreEditable,
  validateSettings,
  type StudioSettings,
  type ViewMetadata,
} from "./contract";
import {
  provider,
  type BakeArtifact,
  type BakeJob,
  type BakeProvider,
} from "./provider";
import {
  lumenDeliveryAdapter,
  lumenAtlasResolution,
  lumenDeliveryBusy,
  lumenWalkthroughUrl,
  sha256,
  validateCompiledSourceSelection,
  validateDirectLightingClaim,
  validateLumenTransfer,
  validateLumenAtlasBudget,
} from "./lumen-delivery";

export const settings = signal(defaults());
export const loading = signal(false);
export const job = signal<BakeJob | null>(null);
export const artifacts = signal<BakeArtifact[]>([]);
export const errorMessage = signal("");
export const resultMatches = signal(false);

export class Studio implements Orchestrator {
  readonly sceneController: SceneController;
  private fly: FlyController;
  private cleanup: Array<() => void> = [];
  private frame = 0;
  private alive = true;
  private generation = 0;
  private bakedIdentity: string | null = null;
  private pending = false;
  private ambient = new AmbientLight();
  private normal = new MeshNormalMaterial();
  private wire = new MeshBasicMaterial({ color: 0xb7c9df, wireframe: true });
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private pollResolve: (() => void) | undefined;
  private lumenAbort: AbortController | undefined;

  constructor(private api: BakeProvider = provider) {
    this.sceneController = new SceneController({
      onSceneChanged: () => this.refresh(),
      onBeforeReplace: () => {
        commandHistory.clear();
        selectedId.value = null;
        activeCameraId.value = null;
      },
      onStaleChange: () => this.refresh(),
      onViewportPick: (id) => {
        selectedId.value = id;
      },
      onTransformChange: (o, before, after) => {
        if (
          before.pos.equals(after.pos) &&
          before.rot.equals(after.rot) &&
          before.scale.equals(after.scale)
        )
          return;
        commandHistory.push(
          new TransformCommand(o, before, after, () => this.refresh()),
        );
        this.refresh();
      },
    });
    this.ambient.userData.editorOnly = true;
    this.sceneController.scene.add(this.ambient);
    this.fly = new FlyController(
      this.sceneController.camera,
      this.sceneController.renderer,
      this.sceneController.controls,
    );
    this.cleanup.push(effect(() => this.setSelection(selectedId.value)));
    this.cleanup.push(effect(() => this.setGizmoMode(gizmoMode.value)));
    const leaveCameraView = () => {
      activeCameraId.value = null;
    };
    this.sceneController.controls.addEventListener("start", leaveCameraView);
    this.cleanup.push(() =>
      this.sceneController.controls.removeEventListener(
        "start",
        leaveCameraView,
      ),
    );
    this.cleanup.push(
      effect(() => {
        if (flyActive.value) activeCameraId.value = null;
      }),
    );
    this.cleanup.push(
      effect(() => {
        this.sceneController.gridHelper.visible = showGrid.value;
        this.sceneController.axesHelper.visible = showAxes.value;
      }),
    );
    this.cleanup.push(
      effect(() => {
        if (this.sceneController.camera.fov !== cameraFOV.value)
          activeCameraId.value = null;
        this.sceneController.setCameraFov(cameraFOV.value);
      }),
    );
    this.cleanup.push(
      effect(() => {
        const s = settings.value;
        this.sceneController.scene.background = new Color(s.world.color);
        this.ambient.color.set(s.world.color);
        this.ambient.intensity = s.world.intensity;
      }),
    );
    const resize = () => this.sceneController.updateSize();
    window.addEventListener("resize", resize);
    this.cleanup.push(() => window.removeEventListener("resize", resize));
    const tick = () => {
      if (!this.alive) return;
      this.fly.tick();
      const sc = this.sceneController;
      sc.controls.update();
      sc.scene.updateMatrixWorld(true);
      sc.updateHelpers();
      sc.scene.overrideMaterial =
        renderMode.value === "normals"
          ? this.normal
          : renderMode.value === "wireframe"
            ? this.wire
            : null;
      sc.renderFrame();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  roots(): Object3D[] {
    const sc = this.sceneController;
    return sc.scene.children.filter(
      (o) =>
        o === sc.cornellRoot ||
        o.userData.bakerLightType ||
        o.userData.bakerCameraType,
    );
  }
  identity(): string {
    return bakeIdentity(this.roots(), settings.peek());
  }
  refresh(): void {
    if (!this.sceneController) return;
    batch(() => {
      sceneTree.value = this.getSceneTree();
      objectTick.value++;
      if (selectedId.peek() && !this.lookupObject(selectedId.peek()))
        selectedId.value = null;
      if (activeCameraId.peek() && !this.lookupObject(activeCameraId.peek()))
        activeCameraId.value = null;
      isStale.value = this.bakedIdentity !== this.identity();
      resultMatches.value = !isStale.peek();
    });
    this.updateHelpers();
  }
  edit(label: string, node: Object3D, mutation: () => void): void {
    const before = editableState(node);
    try {
      mutation();
      node.updateMatrixWorld(true);
    } catch (error) {
      restoreEditable(node, before);
      throw error;
    }
    const after = editableState(node);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    commandHistory.push({
      label,
      undo: () => {
        restoreEditable(node, before);
        this.refresh();
      },
      redo: () => {
        restoreEditable(node, after);
        this.refresh();
      },
    });
    this.refresh();
  }
  editSettings(next: StudioSettings): void {
    const after = validateSettings(next);
    const before = structuredClone(settings.peek());
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const apply = (s: StudioSettings) => {
      settings.value = structuredClone(s);
      this.refresh();
    };
    apply(after);
    commandHistory.push({
      label: "Scene settings",
      undo: () => apply(before),
      redo: () => apply(after),
    });
  }
  editView(next: typeof postFXSettings.value): void {
    const before = { ...postFXSettings.peek() };
    const after = { ...next };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    postFXSettings.value = after;
    commandHistory.push({
      label: "View settings",
      undo: () => {
        postFXSettings.value = before;
      },
      redo: () => {
        postFXSettings.value = after;
      },
    });
  }
  addAsset(spec: AssetSpec, position = new Vector3()): void {
    const id = this.sceneController.addAsset(spec, position);
    const node = this.lookupObject(id);
    if (!node?.parent) return;
    commandHistory.push(
      new AddCommand(this.sceneController, node, node.parent),
    );
    selectedId.value = id;
    this.refresh();
  }
  deleteSelected(): void {
    const id = selectedId.peek();
    if (!id) return;
    const detached = this.sceneController.detachNode(id);
    if (detached)
      commandHistory.push(
        new RemoveCommand(
          this.sceneController,
          detached.node,
          detached.parent,
          detached.index,
        ),
      );
    selectedId.value = null;
    this.refresh();
  }
  setSelection(id: string | null): void {
    const o = this.lookupObject(id);
    this.sceneController.attachGizmoTo(o);
    this.updateHelpers();
    if (o?.userData.bakerLightType) inspectorTab.value = "light";
    else if (o && inspectorTab.peek() === "light")
      inspectorTab.value = "object";
    if (o && !(o instanceof Mesh) && gizmoMode.peek() === "scale")
      gizmoMode.value = "translate";
  }
  setGizmoMode(mode: "translate" | "rotate" | "scale"): void {
    const node = this.lookupObject(selectedId.peek());
    if (mode === "scale" && node && !(node instanceof Mesh)) {
      gizmoMode.value = "translate";
      return;
    }
    this.sceneController.setGizmoMode(mode);
  }
  setNodeVisible(id: string, visible: boolean): void {
    const o = this.lookupObject(id);
    if (o)
      this.edit("Visibility", o, () => {
        o.visible = visible;
      });
  }
  frameNode(id: string): void {
    const o = this.lookupObject(id);
    if (o) this.sceneController.frameObject(o);
  }
  setAsViewCamera(id: string): void {
    this.sceneController.syncViewportToCamera(id);
    cameraFOV.value = this.sceneController.camera.fov;
    activeCameraId.value = id;
  }
  captureCamera(id: string): void {
    const o = this.lookupObject(id);
    if (o)
      this.edit("Capture viewport camera", o, () =>
        this.sceneController.syncCameraToViewport(id),
      );
  }
  updateHelpers(): void {
    if (activeCameraId.peek()) {
      this.sceneController.syncViewportToCamera(activeCameraId.peek()!);
      cameraFOV.value = this.sceneController.camera.fov;
    }
    this.sceneController.scene.updateMatrixWorld(true);
    this.sceneController.updateHelpers();
    for (const group of this.sceneController.scene.children) {
      const helper = group.userData.cameraHelper as Object3D | undefined;
      if (helper) helper.visible = group.uuid === selectedId.peek();
    }
  }
  lookupObject(id: string | null): Object3D | null {
    return this.sceneController.lookupObject(id);
  }
  getSceneTree() {
    return this.sceneController.buildSceneTree();
  }
  getScene() {
    return this.sceneController.scene;
  }
  async loadScenePreset(id: string): Promise<void> {
    if (loading.peek()) return;
    loading.value = true;
    errorMessage.value = "";
    try {
      const hints = await this.sceneController.loadPresetById(id);
      this.generation++;
      this.bakedIdentity = null;
      artifacts.value = [];
      const p = sceneRegistry.get(id)!;
      const s = defaults();
      const d = p.defaultBakeSettings;
      s.bake.resolution = Math.min(1024, Math.max(128, d?.resolution ?? 256));
      s.bake.samples = Math.min(128, Math.max(4, d?.samples ?? 16));
      s.bake.bounces = Math.min(4, Math.max(0, d?.bounces ?? 2));
      const bg = this.getScene().background;
      if (bg instanceof Color) s.world.color = "#" + bg.getHexString();
      s.world.intensity = Math.max(0, Math.min(4, hints.skyIntensity ?? 0.15));
      settings.value = s;
      activeSceneId.value = id;
      cameraFOV.value = this.sceneController.camera.fov;
      this.refresh();
    } catch (cause) {
      this.report(cause);
    } finally {
      loading.value = false;
    }
  }
  view(): ViewMetadata {
    const sc = this.sceneController;
    return {
      position: sc.camera.position.toArray(),
      target: sc.controls.target.toArray(),
      fov: sc.camera.fov,
      near: sc.camera.near,
      far: sc.camera.far,
      mode: renderMode.peek(),
      grid: showGrid.peek(),
      axes: showAxes.peek(),
      flySpeed: flySpeed.peek(),
      postFX: { ...postFXSettings.peek() },
    };
  }
  document() {
    return projectDocument(
      this.roots(),
      settings.peek(),
      this.view(),
      activeSceneId.peek(),
    );
  }
  saveProject(): void {
    download(
      new Blob([JSON.stringify(this.document())], { type: "application/json" }),
      "lightbaker-studio.json",
    );
  }
  openProjectFile(): void {
    chooseFile(".json", async (file) =>
      this.openProject(JSON.parse(await file.text())),
    );
  }
  async openProject(value: unknown): Promise<void> {
    if (loading.peek()) return;
    try {
      loading.value = true;
      const { root, document: p } = await parseProject(value);
      this.sceneController.replaceContent(root);
      settings.value = validateSettings(p.settings);
      activeSceneId.value = p.preset;
      const sc = this.sceneController;
      sc.camera.position.fromArray(p.view.position);
      sc.controls.target.fromArray(p.view.target);
      cameraFOV.value = p.view.fov;
      sc.camera.near = p.view.near;
      sc.camera.far = p.view.far;
      sc.camera.updateProjectionMatrix();
      sc.controls.update();
      renderMode.value = ["lit", "normals", "wireframe"].includes(p.view.mode)
        ? p.view.mode
        : "lit";
      showGrid.value = !!p.view.grid;
      showAxes.value = !!p.view.axes;
      flySpeed.value = Math.max(0.1, Math.min(50, p.view.flySpeed || 5));
      postFXSettings.value = { ...defaultPostFX(), ...p.view.postFX };
      this.generation++;
      this.bakedIdentity = null;
      artifacts.value = [];
      this.refresh();
    } catch (cause) {
      this.report(cause);
    } finally {
      loading.value = false;
    }
  }
  importGLB(): void {
    chooseFile(".glb", async (file) => {
      if (loading.peek()) return;
      loading.value = true;
      try {
        const metadata = await this.sceneController.importGLB(file);
        settings.value = metadata.settings ?? defaults();
        if (metadata.view) {
          const v = metadata.view,
            sc = this.sceneController;
          sc.camera.position.fromArray(v.position);
          sc.controls.target.fromArray(v.target);
          sc.camera.fov = v.fov;
          sc.camera.near = v.near;
          sc.camera.far = v.far;
          sc.camera.updateProjectionMatrix();
          sc.controls.update();
          postFXSettings.value = { ...defaultPostFX(), ...v.postFX };
          showAxes.value = v.axes;
          showGrid.value = v.grid;
          flySpeed.value = v.flySpeed;
          renderMode.value = ["lit", "normals", "wireframe"].includes(v.mode)
            ? v.mode
            : "lit";
        }
        activeSceneId.value = file.name;
        this.generation++;
        this.bakedIdentity = null;
        artifacts.value = [];
        cameraFOV.value = this.sceneController.camera.fov;
        this.refresh();
      } finally {
        loading.value = false;
      }
    });
  }
  async exportSceneGLB(): Promise<void> {
    try {
      download(
        new Blob(
          [await exportScene(this.roots(), settings.peek(), this.view())],
          { type: "model/gltf-binary" },
        ),
        "lightbaker-scene.glb",
      );
    } catch (cause) {
      this.report(cause);
    }
  }
  async exportLumenGeometryGLB(): Promise<void> {
    try {
      download(
        new Blob([await exportLumenGeometry(this.roots())], { type: 'model/gltf-binary' }),
        'lumen-geometry-source.glb',
      );
    } catch (cause) {
      this.report(cause);
    }
  }
  chooseCompiledLumenGLB(): void {
    if (!lumenDeliveryAdapter.peek()) {
      this.report(new Error('Private WebGPU Lumen delivery adapter is not installed'));
      return;
    }
    chooseFiles('.json,.glb', (files) => this.deliverLumenTransfer(files));
  }
  /** Complete the private local path without exposing compiler or baker code in Studio. */
  async deliverLocalLumenPackage(): Promise<void> {
    const adapter = lumenDeliveryAdapter.peek();
    if (!adapter?.compile || !adapter.attach)
      throw new Error('Private local Lumen compiler and attachment adapter is not installed');
    if (lumenDeliveryBusy.peek() || loading.peek()) return;
    const identity = this.identity();
    const generation = this.generation;
    const atlasResolution = lumenAtlasResolution.peek();
    const abort = new AbortController();
    this.lumenAbort = abort;
    lumenDeliveryBusy.value = true;
    lumenWalkthroughUrl.value = null;
    errorMessage.value = '';
    let stagedJobId: string | null = null;
    let delivered = false;
    try {
      const rawSourceGlb = await exportLumenGeometry(this.roots());
      const authoredGlb = await exportScene(this.roots(), settings.peek(), this.view());
      const [rawSourceSha256, authoredSha256] = await Promise.all([sha256(rawSourceGlb), sha256(authoredGlb)]);
      let sourceGlb = rawSourceGlb;
      if (lumenGeometryReadiness(this.roots()).missingUv1) {
        if (!adapter.prepareSource)
          throw new Error('Private local UV1 preparation is required for this Studio scene');
        sourceGlb = await adapter.prepareSource({ sourceGlb: rawSourceGlb,
          atlasResolution, signal: abort.signal });
      }
      if (abort.signal.aborted) return;
      const compiled = await adapter.compile({ sourceGlb, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!compiled || typeof compiled.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(compiled.jobId))
        throw new Error('Local compiler returned an invalid package identity');
      stagedJobId = compiled.jobId;
      const provenance = await validateCompiledSourceSelection(
        compiled.manifestBytes, compiled.compiledGlb, sourceGlb);
      validateLumenAtlasBudget(compiled.compiledGlb, atlasResolution);
      await this.assertCurrentLumenScene(identity, generation, rawSourceSha256, authoredSha256, atlasResolution);
      if (abort.signal.aborted) return;
      const value = await adapter.bake({ compiledGlb: compiled.compiledGlb, authoredGlb,
        sourceSha256: provenance.sourceSha256, atlasResolution, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          !Object.prototype.hasOwnProperty.call(value, 'transfer') ||
          !Object.prototype.hasOwnProperty.call(value, 'directLighting'))
        throw new Error('Private local baker did not return separate indirect and direct lighting');
      const result = value as { transfer: unknown; directLighting: unknown };
      const transfer = await validateLumenTransfer(result.transfer, compiled.compiledGlb);
      const directLighting = validateDirectLightingClaim(result.directLighting,
        provenance.geometrySha256, provenance.sourceSha256, authoredSha256);
      await this.assertCurrentLumenScene(identity, generation, rawSourceSha256, authoredSha256, atlasResolution);
      if (abort.signal.aborted) return;
      const attached = await adapter.attach({ jobId: compiled.jobId, transfer, directLighting, signal: abort.signal });
      if (abort.signal.aborted) return;
      await this.assertCurrentLumenScene(identity, generation, rawSourceSha256, authoredSha256, atlasResolution);
      if (typeof attached?.walkthroughUrl !== 'string' || !attached.walkthroughUrl.startsWith('/'))
        throw new Error('Local attachment returned an invalid walkthrough URL');
      const url = new URL(attached?.walkthroughUrl, globalThis.location.href);
      if (url.origin !== globalThis.location.origin || !['http:', 'https:'].includes(url.protocol))
        throw new Error('Local attachment returned an invalid walkthrough URL');
      lumenWalkthroughUrl.value = url.href;
      delivered = true;
    } catch (cause) {
      if (!abort.signal.aborted) this.report(cause);
    } finally {
      if (!delivered && stagedJobId && adapter.discard) {
        try { await adapter.discard({ jobId: stagedJobId }); }
        catch { /* Preserve the original error; bridge may still be finishing a canceled attach. */ }
      }
      if (this.lumenAbort === abort) this.lumenAbort = undefined;
      lumenDeliveryBusy.value = false;
    }
  }
  private async assertCurrentLumenScene(
    identity: string, generation: number, sourceSha256: string, authoredSha256: string,
    atlasResolution: number,
  ): Promise<void> {
    const [currentSourceSha256, currentAuthoredSha256] = await Promise.all([
      exportLumenGeometry(this.roots()).then(sha256),
      exportScene(this.roots(), settings.peek(), this.view()).then(sha256),
    ]);
    if (generation !== this.generation || identity !== this.identity() ||
        lumenAtlasResolution.peek() !== atlasResolution ||
        currentSourceSha256 !== sourceSha256 || currentAuthoredSha256 !== authoredSha256)
      throw new Error('Studio scene changed during Lumen delivery; discard the stale package and bake again');
  }
  async deliverLumenTransfer(files: readonly File[]): Promise<void> {
    const adapter = lumenDeliveryAdapter.peek();
    if (!adapter) throw new Error('Private WebGPU Lumen delivery adapter is not installed');
    if (lumenDeliveryBusy.peek() || loading.peek()) return;
    const geometryFile = files.find(file => file.name === 'geometry.glb');
    const manifestFile = files.find(file => file.name === 'scene.json');
    if (files.length !== 2 || !geometryFile || !manifestFile ||
        geometryFile.size < 28 || geometryFile.size > 64 * 1024 * 1024 ||
        manifestFile.size < 2 || manifestFile.size > 4 * 1024 * 1024)
      throw new Error('Select scene.json and geometry.glb from the same compiled Lumen package');
    const identity = this.identity();
    const generation = this.generation;
    const abort = new AbortController();
    this.lumenAbort = abort;
    lumenDeliveryBusy.value = true;
    errorMessage.value = '';
    try {
      const sourceGlb = await exportLumenGeometry(this.roots());
      const authoredGlb = await exportScene(this.roots(), settings.peek(), this.view());
      const [compiledGlb, manifestBytes] = await Promise.all([geometryFile.arrayBuffer(), manifestFile.arrayBuffer()]);
      const provenance = await validateCompiledSourceSelection(manifestBytes, compiledGlb, sourceGlb);
      const authoredSha256 = await sha256(authoredGlb);
      if (abort.signal.aborted) return;
      const value = await adapter.bake({ compiledGlb, authoredGlb, signal: abort.signal });
      if (abort.signal.aborted) return;
      const transfer = await validateLumenTransfer(value, compiledGlb);
      const [currentSourceSha256, currentAuthoredSha256] = await Promise.all([
        exportLumenGeometry(this.roots()).then(sha256),
        exportScene(this.roots(), settings.peek(), this.view()).then(sha256),
      ]);
      if (generation !== this.generation || identity !== this.identity() ||
          currentSourceSha256 !== provenance.sourceSha256 || currentAuthoredSha256 !== authoredSha256)
        throw new Error('Studio scene changed during Lumen bake; discard the stale transfer and bake again');
      download(new Blob([JSON.stringify(transfer)], { type: 'application/json' }), 'lumen-indirect-transfer.json');
    } catch (cause) {
      if (!abort.signal.aborted) this.report(cause);
    } finally {
      if (this.lumenAbort === abort) this.lumenAbort = undefined;
      lumenDeliveryBusy.value = false;
    }
  }
  async requestBake(): Promise<void> {
    if (this.pending || loading.peek() || !this.alive) return;
    this.pending = true;
    bakeStatus.value = "baking";
    job.value = null;
    errorMessage.value = "";
    artifacts.value = [];
    const identity = this.identity();
    const generation = this.generation;
    try {
      // Snapshot happens synchronously before the first await. Edits during upload/polling remain stale.
      const buffer = await exportScene(
        this.roots(),
        settings.peek(),
        this.view(),
      );
      let current = await this.api.bakeScene({
        file: new File([buffer], "studio.glb", { type: "model/gltf-binary" }),
      });
      while (
        this.alive &&
        (current.status === "queued" || current.status === "running")
      ) {
        job.value = current;
        await new Promise<void>((resolve) => {
          this.pollResolve = resolve;
          this.pollTimer = setTimeout(resolve, 1200);
        });
        if (!this.alive) return;
        current = await this.api.getJob(current.id);
      }
      if (!this.alive) return;
      job.value = current;
      if (current.status === "failed")
        throw new Error(current.error || "Platform bake failed");
      const results = await this.api.getArtifacts(current.id);
      if (!this.alive) return;
      if (generation === this.generation) {
        artifacts.value = results;
        this.bakedIdentity = identity;
      }
      bakeStatus.value = "done";
      this.refresh();
    } catch (cause) {
      if (this.alive) {
        bakeStatus.value = "error";
        this.report(cause);
      }
    } finally {
      this.pending = false;
    }
  }
  report(cause: unknown): void {
    errorMessage.value = cause instanceof Error ? cause.message : String(cause);
  }
  dispose(): void {
    this.alive = false;
    this.lumenAbort?.abort();
    clearTimeout(this.pollTimer);
    this.pollResolve?.();
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((f) => f());
    disposePresetLoaders();
    this.fly.dispose();
    commandHistory.clear();
    this.sceneController.dispose();
    this.normal.dispose();
    this.wire.dispose();
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function chooseFile(accept: string, read: (file: File) => Promise<void>): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file)
      void read(file).catch((cause) => {
        errorMessage.value = String(cause);
      });
  };
  input.click();
}
function chooseFiles(accept: string, read: (files: File[]) => Promise<void>): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = true;
  input.onchange = () => {
    void read(Array.from(input.files ?? [])).catch(cause => { errorMessage.value = String(cause); });
  };
  input.click();
}
