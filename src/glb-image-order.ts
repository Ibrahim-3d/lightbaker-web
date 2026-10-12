/** Stabilize GLTFExporter's async image completion order without changing payloads.
 * This is deliberately restricted to its single-buffer, dedicated image-tail profile.
 * Unknown extras and MIME metadata are preserved; unsupported extensions fail closed.
 */
export function stabilizeExportedImageOrder(source: ArrayBuffer): ArrayBuffer {
  const header = new DataView(source),
    bytes = new Uint8Array(source);
  const fail = (): never => {
    throw new Error("Unsupported GLTFExporter image buffer layout.");
  };
  if (
    source.byteLength < 20 ||
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== source.byteLength ||
    header.getUint32(16, true) !== 0x4e4f534a
  )
    fail();
  const jsonLength = header.getUint32(12, true),
    binHeader = 20 + jsonLength;
  if (binHeader > source.byteLength) fail();
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, binHeader)),
  );
  if (!json.images?.length) return source;
  if (
    binHeader + 8 > source.byteLength ||
    header.getUint32(binHeader + 4, true) !== 0x004e4942 ||
    binHeader + 8 + header.getUint32(binHeader, true) !== source.byteLength ||
    json.buffers?.length !== 1 ||
    json.buffers[0].uri !== undefined
  )
    fail();
  const bin = bytes.subarray(binHeader + 8),
    views = json.bufferViews;
  if (!Array.isArray(views)) fail();
  const imageIndices: number[] = [];
  for (const image of json.images) {
    if (
      !Number.isInteger(image.bufferView) ||
      image.bufferView < 0 ||
      image.bufferView >= views.length ||
      image.uri !== undefined
    )
      fail();
    if (!imageIndices.includes(image.bufferView))
      imageIndices.push(image.bufferView);
  }
  const slots = [...imageIndices].sort((a, b) => a - b),
    firstSlot = slots[0]!;
  if (
    slots.some((v, i) => v !== firstSlot + i) ||
    firstSlot + slots.length !== views.length
  )
    fail();
  for (const accessor of json.accessors ?? [])
    for (const ref of [
      accessor.bufferView,
      accessor.sparse?.indices?.bufferView,
      accessor.sparse?.values?.bufferView,
    ]) {
      if (ref !== undefined && slots.includes(ref)) fail();
    }
  const supportedExtensions = new Set([
    "KHR_lights_punctual",
    "KHR_texture_transform",
    "KHR_materials_unlit",
    "KHR_materials_pbrSpecularGlossiness",
    "KHR_materials_clearcoat",
    "KHR_materials_transmission",
    "KHR_materials_volume",
    "KHR_materials_ior",
    "KHR_materials_specular",
    "KHR_materials_iridescence",
    "KHR_materials_sheen",
    "KHR_materials_emissive_strength",
    "KHR_materials_anisotropy",
    "KHR_materials_dispersion",
    "KHR_materials_diffuse_transmission",
    "EXT_mesh_gpu_instancing",
    "KHR_mesh_quantization",
  ]);
  const checkExtensions = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "extras") continue;
      if (key === "extensions") {
        if (
          !child ||
          typeof child !== "object" ||
          Object.keys(child).some((name) => !supportedExtensions.has(name))
        )
          fail();
        const inspect = (node: unknown): void => {
          if (!node || typeof node !== "object") return;
          for (const [name, item] of Object.entries(node)) {
            if (["bufferView", "buffer", "byteOffset"].includes(name)) fail();
            inspect(item);
          }
        };
        inspect(child);
      }
      checkExtensions(child);
    }
  };
  checkExtensions(json);
  let imageStart = Infinity;
  for (const index of slots) {
    const view = views[index];
    if (
      view.buffer !== 0 ||
      !Number.isSafeInteger(view.byteOffset) ||
      !Number.isSafeInteger(view.byteLength) ||
      view.byteOffset < 0 ||
      view.byteLength < 1 ||
      view.byteOffset + view.byteLength > bin.length ||
      view.byteOffset % 4 !== 0
    )
      fail();
    imageStart = Math.min(imageStart, view.byteOffset);
  }
  let end = imageStart;
  for (const index of slots) {
    const view = views[index];
    if (view.byteOffset !== end) fail();
    end += Math.ceil(view.byteLength / 4) * 4;
  }
  if (end !== bin.length) fail();
  for (let i = 0; i < firstSlot; i++)
    if ((views[i].byteOffset ?? 0) + views[i].byteLength > imageStart) fail();
  const outputBin = new Uint8Array(bin.length);
  outputBin.set(bin.subarray(0, imageStart));
  const originalViews = [...views],
    remap = new Map<number, number>();
  let offset = imageStart;
  imageIndices.forEach((oldIndex, i) => {
    const view = originalViews[oldIndex],
      paddedLength = Math.ceil(view.byteLength / 4) * 4;
    outputBin.set(
      bin.subarray(view.byteOffset, view.byteOffset + paddedLength),
      offset,
    );
    views[slots[i]!] = { ...view, byteOffset: offset };
    remap.set(oldIndex, slots[i]!);
    offset += paddedLength;
  });
  for (const image of json.images)
    image.bufferView = remap.get(image.bufferView);
  const encoded = new TextEncoder().encode(JSON.stringify(json)),
    jsonSize = Math.ceil(encoded.length / 4) * 4;
  const output = new ArrayBuffer(28 + jsonSize + outputBin.length),
    result = new DataView(output),
    all = new Uint8Array(output);
  result.setUint32(0, 0x46546c67, true);
  result.setUint32(4, 2, true);
  result.setUint32(8, output.byteLength, true);
  result.setUint32(12, jsonSize, true);
  result.setUint32(16, 0x4e4f534a, true);
  all.fill(32, 20, 20 + jsonSize);
  all.set(encoded, 20);
  result.setUint32(20 + jsonSize, outputBin.length, true);
  result.setUint32(24 + jsonSize, 0x004e4942, true);
  all.set(outputBin, 28 + jsonSize);
  return output;
}
