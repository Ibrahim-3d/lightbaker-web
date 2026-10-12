import { expect, it } from 'vitest';
import { registerLumenDeliveryAdapter, lumenDeliveryAdapter, sha256, validateCompiledSourceSelection, validateLumenAtlasBudget, validateLumenTransfer } from '../../src/lumen-delivery';

function glb(marker = 0): ArrayBuffer {
  const bytes = new Uint8Array(28);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, 28, true);
  header.setUint32(12, 8, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.set(new TextEncoder().encode(marker ? '{"x":1}' : '{}      '), 20);
  return bytes.buffer;
}

function compiledPlacements(nodes: number, primitives = 1): ArrayBuffer {
  const json = JSON.stringify({ asset: { version: '2.0' },
    nodes: Array.from({ length: nodes }, () => ({ mesh: 0 })),
    meshes: [{ primitives: Array.from({ length: primitives }, () => ({ attributes: { TEXCOORD_1: 0 } })) }],
  });
  const padded = json.padEnd(Math.ceil(json.length / 4) * 4, ' ');
  const bytes = new Uint8Array(20 + padded.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(new TextEncoder().encode(padded), 20);
  return bytes.buffer;
}

it('preflights receiver bindings without confusing shared UV receivers with atlas textures', () => {
  expect(validateLumenAtlasBudget(compiledPlacements(7), 128)).toBe(7);
  expect(validateLumenAtlasBudget(compiledPlacements(3, 2), 256)).toBe(6);
  expect(validateLumenAtlasBudget(compiledPlacements(7), 512)).toBe(7);
  expect(validateLumenAtlasBudget(compiledPlacements(177), 512)).toBe(177);
  expect(validateLumenAtlasBudget(compiledPlacements(65), 64)).toBe(65);
  expect(() => validateLumenAtlasBudget(compiledPlacements(10001), 64)).toThrow(/at most 10000 bindings/);
  expect(validateLumenAtlasBudget(compiledPlacements(65), 1024)).toBe(65);
  expect(validateLumenAtlasBudget(compiledPlacements(65), 2048)).toBe(65);
  expect(() => validateLumenAtlasBudget(compiledPlacements(1), 4096)).toThrow(/must be 64/);
  expect(() => validateLumenAtlasBudget(glb(), 128)).toThrow(/node and mesh arrays/);
});

it('binds compiler source and geometry fingerprints and rejects stale or tampered selections', async () => {
  const source = glb(), compiled = glb(1);
  const manifest = {
    format: 'lumen-asset-scene', version: 1, units: 'meters',
    source: { byteLength: source.byteLength, sha256: await sha256(source) },
    geometry: { file: 'geometry.glb', byteLength: compiled.byteLength, sha256: await sha256(compiled) },
  };
  const bytes = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer;
  await expect(validateCompiledSourceSelection(bytes(manifest), compiled, source)).resolves.toEqual({
    sourceSha256: manifest.source.sha256, geometrySha256: manifest.geometry.sha256,
  });
  await expect(validateCompiledSourceSelection(bytes(manifest), compiled, glb(1))).rejects.toThrow(/does not match/);
  await expect(validateCompiledSourceSelection(bytes(manifest), glb(), source)).rejects.toThrow(/does not match/);
  await expect(validateCompiledSourceSelection(bytes({ ...manifest, source: undefined }), compiled, source)).rejects.toThrow(/provenance/);
  await expect(validateCompiledSourceSelection(bytes({ ...manifest, source: { ...manifest.source, sha256: '0'.repeat(64) } }), compiled, source)).rejects.toThrow(/does not match/);
  await expect(validateCompiledSourceSelection(bytes({ ...manifest, geometry: { ...manifest.geometry, sha256: '0'.repeat(64) } }), compiled, source)).rejects.toThrow(/does not match/);
  const tampered = compiled.slice(0); new Uint8Array(tampered)[24] ^= 1;
  await expect(validateCompiledSourceSelection(bytes(manifest), tampered, source)).rejects.toThrow(/does not match/);
});

it('requires one explicitly installed private delivery adapter', () => {
  const adapter = { bake: async () => ({}) };
  const remove = registerLumenDeliveryAdapter(adapter);
  expect(lumenDeliveryAdapter.peek()).toBe(adapter);
  expect(() => registerLumenDeliveryAdapter(adapter)).toThrow(/already installed/);
  remove();
  expect(lumenDeliveryAdapter.peek()).toBeNull();
});

it('rejects a transfer that lies about geometry or includes direct light', async () => {
  const compiled = new Uint8Array([1, 2, 3]).buffer;
  const digest = await crypto.subtle.digest('SHA-256', compiled);
  const geometrySha256 = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
  const transfer = {
    format: 'lightbaker-lumen-lighting-v2', geometrySha256,
    geometryCorrespondence: 'compiled-glb-exact', lightingComponent: 'indirect-plus-baked-radiance',
    bakedRadianceIncluded: true,
    directLightingIncluded: false, encoding: 'linear-irradiance-f32-rgb',
    rowOrigin: 'uv-v-zero', uvChannel: 1, refined: true,
    atlases: [{ width: 1, height: 1, rgb: [0, 0, 0], bakedRadianceRgb: [0.1, 0, 0] }],
    bindings: [{ node: 0, mesh: 0, primitive: 0, atlas: 0, intensity: 1 }],
  };
  await expect(validateLumenTransfer(transfer, compiled)).resolves.toEqual(transfer);
  await expect(validateLumenTransfer({ ...transfer, directLightingIncluded: true }, compiled)).rejects.toThrow(/incompatible/);
  await expect(validateLumenTransfer({ ...transfer, geometrySha256: '0'.repeat(64) }, compiled)).rejects.toThrow(/incompatible/);
  await expect(validateLumenTransfer({ ...transfer, atlases: [{ width: 1, height: 1, rgb: [0, 0, 0] }] }, compiled)).rejects.toThrow(/baked radiance atlas/);
  await expect(validateLumenTransfer({ ...transfer, bakedRadianceIncluded: false }, compiled)).rejects.toThrow(/incompatible/);
});

async function boundedTransferFixture() {
  const compiled = glb();
  const transfer = {
    format: 'lightbaker-lumen-lighting-v2', geometrySha256: await sha256(compiled),
    geometryCorrespondence: 'compiled-glb-exact', lightingComponent: 'indirect-plus-baked-radiance',
    bakedRadianceIncluded: true, directLightingIncluded: false,
    encoding: 'linear-irradiance-f32-rgb', rowOrigin: 'uv-v-zero', uvChannel: 1, refined: true,
    atlases: [{ width: 1, height: 1, rgb: [0, 0, 0], bakedRadianceRgb: [0, 0, 0] }],
    bindings: [{ node: 0, mesh: 0, primitive: 0, atlas: 0, intensity: 1 }],
  };
  return { compiled, transfer };
}

// An empty array advertises its claimed length without allocating pixel storage.
function unreadableChannels(length: number): number[] {
  return new Proxy([] as number[], {
    get(target, key, receiver) {
      if (key === 'length') return length;
      if (key === Symbol.iterator || key === 'every' || (typeof key === 'string' && /^\d+$/.test(key)))
        throw new Error('Channels were scanned before metadata preflight completed');
      return Reflect.get(target, key, receiver);
    },
  });
}

it('bounds atlas and binding counts before inspecting channel values', async () => {
  const { compiled, transfer } = await boundedTransferFixture();
  const atlas = { width: 1, height: 1, rgb: unreadableChannels(3), bakedRadianceRgb: unreadableChannels(3) };
  await expect(validateLumenTransfer({ ...transfer, atlases: Array(65).fill(atlas) }, compiled)).rejects.toThrow(/incompatible/);
  await expect(validateLumenTransfer({ ...transfer, atlases: [atlas], bindings: new Array(10_001) }, compiled)).rejects.toThrow(/incompatible/);
  await expect(validateLumenTransfer({ ...transfer, atlases: Array(64).fill(transfer.atlases[0]),
    bindings: Array(10_000).fill(transfer.bindings[0]) }, compiled)).resolves.toBeDefined();
});

it.each([0, -1, 0.5, 4097, Infinity, NaN, '1', null])('rejects unsupported atlas dimension %s before channel scans', async width => {
  const { compiled, transfer } = await boundedTransferFixture();
  for (const dimensions of [{ width, height: 1 }, { width: 1, height: width }]) {
    await expect(validateLumenTransfer({ ...transfer, atlases: [{ ...dimensions,
      rgb: unreadableChannels(3), bakedRadianceRgb: unreadableChannels(3) }] }, compiled)).rejects.toThrow(/baked radiance atlas/);
  }
});

it('preserves compatible nonsquare atlases beyond the local square bake preset', async () => {
  const { compiled, transfer } = await boundedTransferFixture();
  for (const dimensions of [{ width: 4096, height: 1 }, { width: 1, height: 4096 }]) {
    await expect(validateLumenTransfer({ ...transfer, atlases: [{ ...dimensions,
      rgb: Array(4096 * 3).fill(0), bakedRadianceRgb: Array(4096 * 3).fill(0) }] }, compiled)).resolves.toBeDefined();
  }
});

it('rejects cumulative atlas pixel overflow before scanning earlier valid-size arrays', async () => {
  const { compiled, transfer } = await boundedTransferFixture();
  const full = { width: 2048, height: 2048,
    rgb: unreadableChannels(3 * 2048 * 2048), bakedRadianceRgb: unreadableChannels(3 * 2048 * 2048) };
  await expect(validateLumenTransfer({ ...transfer, atlases: [full, transfer.atlases[0]] }, compiled)).rejects.toThrow(/baked radiance atlas/);
});

it('rejects sparse, nonfinite and out-of-range radiance while accepting the maximum channel', async () => {
  const { compiled, transfer } = await boundedTransferFixture();
  for (const channels of [new Array(3), [NaN, 0, 0], [Infinity, 0, 0], [-1, 0, 0], [65505, 0, 0]]) {
    for (const slot of ['rgb', 'bakedRadianceRgb']) {
      await expect(validateLumenTransfer({ ...transfer,
        atlases: [{ ...transfer.atlases[0], [slot]: channels }] }, compiled)).rejects.toThrow(/baked radiance atlas/);
    }
  }
  await expect(validateLumenTransfer({ ...transfer,
    atlases: [{ ...transfer.atlases[0], bakedRadianceRgb: [65504, 0, 0] }] }, compiled)).resolves.toBeDefined();
});
