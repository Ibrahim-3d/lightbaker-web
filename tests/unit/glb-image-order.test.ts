import { describe, it, expect } from "vitest";
import { stabilizeExportedImageOrder } from "../../src/glb-image-order";
function fixture(reverse = false, edit = 0, change?: (json: any) => void) {
  const imageA = new Uint8Array([11 + edit, 12, 13, 99]),
    imageB = new Uint8Array([21, 22, 23, 24, 25, 88, 77, 66]);
  const images = reverse ? [imageB, imageA] : [imageA, imageB];
  const views: any[] = [
    { buffer: 0, byteOffset: 0, byteLength: 4, target: 34962 },
  ];
  let offset = 4;
  for (const bytes of images) {
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes === imageA ? 3 : 5,
    });
    offset += bytes.length;
  }
  const json: any = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors: [
      {
        bufferView: 0,
        componentType: 5121,
        count: 4,
        type: "SCALAR",
        sparse: {
          count: 1,
          indices: { bufferView: 0, componentType: 5121 },
          values: { bufferView: 0 },
        },
      },
    ],
    images: [
      {
        bufferView: reverse ? 2 : 1,
        mimeType: "image/png",
        extras: { bufferView: "metadata preserved" },
      },
      { bufferView: reverse ? 1 : 2, mimeType: "image/custom" },
    ],
    extensions: { KHR_materials_unlit: {} },
    materials: [{ name: "original" }],
  };
  change?.(json);
  const text = new TextEncoder().encode(JSON.stringify(json)),
    size = Math.ceil(text.length / 4) * 4;
  const output = new ArrayBuffer(28 + size + offset),
    data = new DataView(output),
    bytes = new Uint8Array(output);
  data.setUint32(0, 0x46546c67, true);
  data.setUint32(4, 2, true);
  data.setUint32(8, output.byteLength, true);
  data.setUint32(12, size, true);
  data.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + size);
  bytes.set(text, 20);
  data.setUint32(20 + size, offset, true);
  data.setUint32(24 + size, 0x004e4942, true);
  bytes.set([1, 2, 3, 4], 28 + size);
  offset = 32 + size;
  for (const image of images) {
    bytes.set(image, offset);
    offset += image.length;
  }
  return output;
}
function unpack(bytes: ArrayBuffer) {
  const view = new DataView(bytes),
    size = view.getUint32(12, true);
  return {
    json: JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, size))),
    bin: new Uint8Array(bytes, 28 + size),
  };
}
describe("deterministic GLTFExporter image completion order", () => {
  it("normalizes reversed async image completion while retaining all payload/padding, geometry references, MIME and metadata", () => {
    const a = stabilizeExportedImageOrder(fixture()),
      b = stabilizeExportedImageOrder(fixture(true));
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
    const { json, bin } = unpack(b);
    expect([...bin]).toEqual([
      1, 2, 3, 4, 11, 12, 13, 99, 21, 22, 23, 24, 25, 88, 77, 66,
    ]);
    expect(json.images[0].bufferView).toBe(1);
    expect(json.images[1].bufferView).toBe(2);
    expect(json.images[1].mimeType).toBe("image/custom");
    expect(json.images[0].extras).toEqual({ bufferView: "metadata preserved" });
    expect(json.extensions).toEqual({ KHR_materials_unlit: {} });
    expect(json.accessors[0].sparse.values.bufferView).toBe(0);
    expect(new Uint8Array(stabilizeExportedImageOrder(b))).toEqual(
      new Uint8Array(b),
    );
  });
  it("retains texture and material edits so stale-source hashes still change", () => {
    const base = new Uint8Array(stabilizeExportedImageOrder(fixture()));
    expect(
      new Uint8Array(stabilizeExportedImageOrder(fixture(false, 1))),
    ).not.toEqual(base);
    expect(
      new Uint8Array(
        stabilizeExportedImageOrder(
          fixture(false, 0, (j) => (j.materials[0].name = "edited")),
        ),
      ),
    ).not.toEqual(base);
  });
  it("fails closed for binary extension references or image/geometry aliasing", () => {
    expect(() =>
      stabilizeExportedImageOrder(
        fixture(
          false,
          0,
          (j) => (j.extensions.KHR_materials_unlit = { bufferView: 1 }),
        ),
      ),
    ).toThrow("Unsupported");
    expect(() =>
      stabilizeExportedImageOrder(
        fixture(
          false,
          0,
          (j) =>
            (j.extensions.EXT_structural_metadata = {
              propertyTables: [{ properties: { p: { values: 1 } } }],
            }),
        ),
      ),
    ).toThrow("Unsupported");
    expect(() =>
      stabilizeExportedImageOrder(
        fixture(false, 0, (j) => (j.extensions.VENDOR_unknown = {})),
      ),
    ).toThrow("Unsupported");
    expect(() =>
      stabilizeExportedImageOrder(
        fixture(false, 0, (j) => (j.accessors[0].bufferView = 1)),
      ),
    ).toThrow("Unsupported");
    expect(() =>
      stabilizeExportedImageOrder(
        fixture(false, 0, (j) => (j.bufferViews[2].byteOffset = 4)),
      ),
    ).toThrow("Unsupported");
  });
});
