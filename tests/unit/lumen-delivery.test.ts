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

it('preflights exact shared and multi-primitive receiver counts against the local atlas budget', () => {
  expect(validateLumenAtlasBudget(compiledPlacements(7), 128)).toBe(7);
  expect(validateLumenAtlasBudget(compiledPlacements(3, 2), 256)).toBe(6);
  expect(() => validateLumenAtlasBudget(compiledPlacements(7), 512)).toThrow(/7 node\/primitive receivers.*at most 3/);
  expect(() => validateLumenAtlasBudget(compiledPlacements(16), 256)).toThrow(/at most 15/);
  expect(() => validateLumenAtlasBudget(compiledPlacements(62), 128)).toThrow(/at most 61/);
  expect(() => validateLumenAtlasBudget(compiledPlacements(65), 64)).toThrow(/at most 64/);
  expect(() => validateLumenAtlasBudget(compiledPlacements(1), 1024)).toThrow(/must be 64/);
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
    format: 'lightbaker-lumen-indirect-v1', geometrySha256,
    geometryCorrespondence: 'compiled-glb-exact', lightingComponent: 'indirect-only',
    directLightingIncluded: false, encoding: 'linear-irradiance-f32-rgb',
    rowOrigin: 'uv-v-zero', uvChannel: 1, refined: true,
    atlases: [{ width: 1, height: 1, rgb: [0, 0, 0] }],
    bindings: [{ node: 0, mesh: 0, primitive: 0, atlas: 0, intensity: 1 }],
  };
  await expect(validateLumenTransfer(transfer, compiled)).resolves.toEqual(transfer);
  await expect(validateLumenTransfer({ ...transfer, directLightingIncluded: true }, compiled)).rejects.toThrow(/incompatible/);
  await expect(validateLumenTransfer({ ...transfer, geometrySha256: '0'.repeat(64) }, compiled)).rejects.toThrow(/incompatible/);
});
