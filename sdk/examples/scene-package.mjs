/** Authored reference data only: a floor and two walls with an area emitter. */
export function referenceScene(metadataVersion = 2) {
  const positions = new Float32Array([
    -2,0,-2, 2,0,-2, 2,0,2, -2,0,2,
    -2,0,-2, -2,3,-2, 2,3,-2, 2,0,-2,
    -2,0,2, -2,3,2, -2,3,-2, -2,0,-2,
  ]);
  const indices = new Uint16Array([0,2,1,0,3,2,4,6,5,4,7,6,8,10,9,8,11,10]);
  const binary = new Uint8Array(positions.byteLength + indices.byteLength);
  binary.set(new Uint8Array(positions.buffer));
  binary.set(new Uint8Array(indices.buffer), positions.byteLength);
  const document = {
    asset: { version: '2.0', generator: 'LightBaker SDK authored reference' }, scene: 0,
    scenes: [{ nodes: [0,1], extras: { lightbaker: { version: metadataVersion,
      world: { color: '#17191d', intensity: 0.15 },
      bake: { resolution: 256, samples: 16, bounces: 2, denoise: true },
    }, lightbakerCamera: { position: [4,3,5], target: [0,1,0], fov: 50 } } }],
    nodes: [
      { name: 'Room shell', mesh: 0, extras: { studioId: 'room-shell', lightbakerVisible: true,
        lightbakerMesh: { receive: true, contribute: true, density: 1 } } },
      { name: 'Ceiling area marker', translation: [0,2.8,0],
        // Authored emitter points down (-90 X); marker compensation (+90 X) yields identity.
        rotation: [0,0,0,1],
        extras: { studioId: 'ceiling-emitter', lightbakerVisible: true,
          lightbakerLight: { type: 'area', color: '#ffffff', intensity: 5, width: 1, height: 1 } } },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.7,0.7,0.7,1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 12, type: 'VEC3', min: [-2,0,-2], max: [2,3,2] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }],
  };
  return encodeGLB(document, binary);
}

export function encodeGLB(document, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const result = new Uint8Array(20 + jsonLength + (binary ? 8 + binaryLength : 0));
  const header = new DataView(result.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.length, true);
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + jsonLength); result.set(json, 20);
  if (binary) {
    header.setUint32(20 + jsonLength, binaryLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true);
    result.set(binary, 28 + jsonLength);
  }
  return result;
}
