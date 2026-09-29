import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RectAreaLight,
  SpotLight,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  authoredSnapshot,
  bakeIdentity,
  defaults,
  editableState,
  exportScene,
  parseProject,
  projectDocument,
  restoreEditable,
  restoreGLBMetadata,
  validateSettings,
  type ViewMetadata,
} from "../../src/contract";
import {
  createAsset,
  wrapAsBakerLight,
} from "../../packages/shared/src/assets/primitives";
import { CommandHistory } from "../../packages/shared/src/history/command-history";
import { disposeTrees } from "../../apps/playground/src/three/resources";
const view: ViewMetadata = {
  position: [0, 3, 12],
  target: [0, 2, 0],
  fov: 50,
  near: 0.1,
  far: 1000,
  mode: "lit",
  grid: true,
  axes: true,
  flySpeed: 5,
  postFX: {},
};
beforeAll(() => {
  vi.stubGlobal(
    "FileReader",
    class {
      result: ArrayBuffer | null = null;
      onloadend = () => {};
      readAsArrayBuffer(blob: Blob) {
        void blob.arrayBuffer().then((b) => {
          this.result = b;
          this.onloadend();
        });
      }
    },
  );
});
describe("authored scene contract", () => {
  it("excludes helpers and circular runtime references without changing the live graph", () => {
    const group = createAsset({ kind: "light", id: "area" })!;
    const light = group.children[0]!;
    const original = group.userData;
    const children = light.children;
    const copied = authoredSnapshot([group]);
    expect(group.userData).toBe(original);
    expect(light.children).toBe(children);
    expect(copied.children[0]!.children[0]!.children).toHaveLength(0);
    expect(() => JSON.stringify(copied.toJSON())).not.toThrow();
  });
  it("roundtrips authored emission, physical transforms, visibility, mesh settings and camera", async () => {
    const mesh = new Mesh(
      new BoxGeometry(),
      new MeshStandardMaterial({
        color: 0x123456,
        emissive: 0xff1100,
        emissiveIntensity: 3,
      }),
    );
    mesh.position.set(1, 2, 3);
    mesh.visible = false;
    mesh.userData.lightbakerMesh = {
      receive: false,
      contribute: true,
      density: 2,
    };
    const camera = createAsset({ kind: "camera", id: "perspective" })!;
    const p = projectDocument([mesh, camera], defaults(), view, "test");
    const restored = (await parseProject(p)).root;
    const result = restored.getObjectByProperty("uuid", mesh.uuid) as Mesh;
    expect(result.position.toArray()).toEqual([1, 2, 3]);
    expect(result.visible).toBe(false);
    expect(result.userData.lightbakerMesh).toEqual(
      mesh.userData.lightbakerMesh,
    );
    expect((result.material as MeshStandardMaterial).emissiveIntensity).toBe(3);
    expect(restored.getObjectByProperty("uuid", camera.uuid)).toBeTruthy();
  });
  it("preserves spot target references and world direction across a project roundtrip", async () => {
    const group = createAsset({ kind: "light", id: "spot" })!;
    group.rotation.set(0.4, 0.9, 0.2);
    const restored = (
      await parseProject(projectDocument([group], defaults(), view, "test"))
    ).root;
    const light = restored.getObjectByProperty(
      "type",
      "SpotLight",
    ) as SpotLight;
    expect(light.target.parent).toBe(restored.children[0]);
    expect(light.target.position.toArray()).toEqual([0, 0, -1]);
  });
  it("converts target-based direction to glTF local -Z without mutating live lights", async () => {
    const parent = new Group();
    parent.rotation.y = 0.5;
    const light = new DirectionalLight();
    light.position.set(3, 4, 5);
    light.target.position.set(-2, 1, -1);
    parent.add(light, light.target);
    parent.updateMatrixWorld(true);
    const expected = light.target
      .getWorldPosition(new Vector3())
      .sub(light.getWorldPosition(new Vector3()))
      .normalize();
    const original = light.quaternion.clone();
    const loaded = (
      await new GLTFLoader().parseAsync(
        await exportScene([parent], defaults(), view),
        "",
      )
    ).scene;
    loaded.updateMatrixWorld(true);
    const result = loaded.getObjectByProperty(
      "type",
      "DirectionalLight",
    ) as DirectionalLight;
    const direction = result.target
      .getWorldPosition(new Vector3())
      .sub(result.getWorldPosition(new Vector3()))
      .normalize();
    expect(direction.distanceTo(expected)).toBeLessThan(1e-6);
    expect(light.quaternion.equals(original)).toBe(true);
  });
  it("preserves area orientation with existing worker marker reconstruction", async () => {
    const group = createAsset({ kind: "light", id: "area" })!;
    group.rotation.set(0.6, 0.9, -0.3);
    group.position.set(2, 3, 4);
    group.updateMatrixWorld(true);
    const light = group.children[0] as RectAreaLight;
    light.width = 3;
    light.height = 4;
    const expected = light.getWorldDirection(new Vector3());
    const loaded = (
      await new GLTFLoader().parseAsync(
        await exportScene([group], defaults(), view),
        "",
      )
    ).scene;
    let marker: Object3D | undefined;
    loaded.traverse((o) => {
      if (o.userData.lightbakerLight?.type === "area") marker = o;
    });
    expect(marker?.userData.lightbakerLight.width).toBe(3);
    const rehydrated = new RectAreaLight();
    rehydrated.rotation.x = -Math.PI / 2;
    marker!.add(rehydrated);
    loaded.updateMatrixWorld(true);
    expect(
      rehydrated.getWorldDirection(new Vector3()).distanceTo(expected),
    ).toBeLessThan(1e-6);
    expect(loaded.userData.lightbaker.version).toBe(2);
    expect(loaded.userData.lightbaker.bake).toEqual(defaults().bake);
    rehydrated.removeFromParent();
    const metadata = restoreGLBMetadata(loaded);
    const restored = loaded.getObjectByProperty(
      "type",
      "RectAreaLight",
    ) as RectAreaLight;
    loaded.updateMatrixWorld(true);
    expect(restored.width).toBe(3);
    expect(
      restored.getWorldDirection(new Vector3()).distanceTo(expected),
    ).toBeLessThan(1e-6);
    expect(metadata.settings).toEqual(defaults());
  });
  it("preserves world transform while wrapping lights under transformed parents", () => {
    const parent = new Group();
    parent.position.set(1, 2, 3);
    parent.rotation.y = 0.7;
    const light = new RectAreaLight();
    light.rotation.x = 0.3;
    parent.add(light);
    parent.updateMatrixWorld(true);
    const position = light.getWorldPosition(new Vector3());
    const direction = light.getWorldDirection(new Vector3());
    const wrapper = wrapAsBakerLight(light);
    wrapper.updateMatrixWorld(true);
    expect(
      light.getWorldPosition(new Vector3()).distanceTo(position),
    ).toBeLessThan(1e-6);
    expect(
      light.getWorldDirection(new Vector3()).distanceTo(direction),
    ).toBeLessThan(1e-6);
  });
  it("rejects invalid settings and future project versions", async () => {
    const s = defaults();
    s.bake.samples = NaN;
    expect(() => validateSettings(s)).toThrow();
    await expect(
      parseProject({ format: "lightbaker-studio", version: 99 }),
    ).rejects.toThrow();
  });
  it("restores all edited material slots and avoids double sRGB conversion", () => {
    const mesh = new Mesh(new BoxGeometry(), [
      new MeshStandardMaterial(),
      new MeshStandardMaterial(),
    ]);
    const before = editableState(mesh);
    mesh.material[1]!.color.set("#808080");
    mesh.material[1]!.roughness = 0.2;
    const after = editableState(mesh);
    restoreEditable(mesh, before);
    restoreEditable(mesh, after);
    expect(mesh.material[1]!.color.getHexString()).toBe("808080");
    expect(mesh.material[1]!.roughness).toBe(0.2);
  });
  it("content identity returns to the baked state after reattach and ignores editor-only helpers", () => {
    const root = new Group();
    const a = createAsset({ kind: "primitive", id: "cube" })!,
      b = createAsset({ kind: "primitive", id: "sphere" })!;
    root.add(a, b);
    const initial = bakeIdentity([root], defaults());
    root.remove(a);
    root.add(a);
    expect(bakeIdentity([root], defaults())).toBe(initial);
    const helper = new Object3D();
    helper.userData.editorOnly = true;
    helper.add(new Mesh());
    root.add(helper);
    expect(bakeIdentity([root], defaults())).toBe(initial);
    a.position.x++;
    expect(bakeIdentity([root], defaults())).not.toBe(initial);
  });
});
describe("history and resource ownership", () => {
  it("disposes redo branches and preserves the stack on failed undo", () => {
    const history = new CommandHistory();
    const dispose = vi.fn();
    history.push({ undo() {}, redo() {}, dispose });
    history.undo();
    history.push({
      undo() {
        throw new Error("blocked");
      },
      redo() {},
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => history.undo()).toThrow("blocked");
    expect(() => history.undo()).toThrow("blocked");
    history.clear();
  });
  it("retains shared resources while another live or history node owns them", () => {
    const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const b = new Mesh(a.geometry, a.material);
    const geometry = vi.spyOn(a.geometry, "dispose");
    const material = vi.spyOn(a.material, "dispose");
    disposeTrees([a], [b]);
    expect(geometry).not.toHaveBeenCalled();
    disposeTrees([a, b]);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });
});
