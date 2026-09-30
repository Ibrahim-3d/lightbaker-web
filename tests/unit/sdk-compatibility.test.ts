import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, RectAreaLight } from "three";
import { defaults, exportScene, type ViewMetadata } from "../../src/contract";
import { LightBakerClient, inspectScenePackage } from "../../sdk/src/index";

beforeAll(() => {
  vi.stubGlobal("FileReader", class {
    result: ArrayBuffer | null = null;
    onloadend = () => {};
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend(); });
    }
  });
});
afterAll(() => vi.unstubAllGlobals());

it("the current Studio serializer submits unchanged through the SDK and yields the reference artifact contract", async () => {
  const group = new Group();
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial({ color: "#aabbcc" });
  const mesh = new Mesh(geometry, material);
  mesh.userData.lightbakerMesh = { receive: true, contribute: false, density: 2 };
  const light = new RectAreaLight("#ffffff", 5, 2, 3);
  light.position.set(1, 4, 2);
  light.rotation.set(-0.5, 0.2, 0.1);
  group.add(mesh, light);
  const view: ViewMetadata = { position: [0, 3, 12], target: [0, 2, 0], fov: 50,
    near: 0.1, far: 1000, mode: "lit", grid: true, axes: true, flySpeed: 5, postFX: {} };
  try {
    const glb = await exportScene([group], defaults(), view);
    expect((await inspectScenePackage(glb)).sceneContractVersion).toBe(2);
    let submitted: ArrayBuffer | undefined;
    let polls = 0;
    const client = new LightBakerClient({ endpoint: "https://api.example.test", fetch: async (url, init) => {
      if (String(url).includes("/bakeScene")) {
        expect(init?.headers).toEqual({ "content-type": "model/gltf-binary" });
        submitted = await (init?.body as Blob).arrayBuffer();
        return Response.json({ id: "studio-job", status: "queued", progress: 0 }, { status: 202 });
      }
      if (String(url).includes("/getJob")) {
        return Response.json({ id: "studio-job", status: ++polls === 1 ? "running" : "completed", progress: polls === 1 ? 10 : 100 });
      }
      return Response.json([{ kind: "preview", name: "baked-preview.png", url: "https://api.example.test/artifacts/studio-job/preview.png" },
        { kind: "lightmap", name: "lightmap.png", url: "https://api.example.test/artifacts/studio-job/lightmap.png" }]);
    } });
    const job = await client.bakeScene({ file: new File([glb], "studio.glb", { type: "model/gltf-binary" }) });
    const result = await client.wait(job.id, { pollIntervalMs: 1 });
    expect(new Uint8Array(submitted!)).toEqual(new Uint8Array(glb));
    expect(result.job.status).toBe("completed");
    expect(result.artifacts.map(artifact => artifact.kind)).toEqual(["preview", "lightmap"]);
    expect(mesh.userData.lightbakerMesh.contribute).toBe(false);
    expect(light.parent).toBe(group);
  } finally { geometry.dispose(); material.dispose(); }
});
