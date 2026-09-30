import { LightBakerError } from './errors.js';
import type { SceneInput, ScenePackageInfo } from './types.js';
import { record } from './utils.js';

function invalid(message: string): never { throw new LightBakerError('INVALID_SCENE', message); }
/** Copy mutable byte inputs. File/Blob inputs are immutable and preserve their exact bytes. */
export function packageBlob(input: SceneInput): Blob {
  const source = record(input) && 'file' in input ? input.file : input;
  if (source instanceof Blob) return source;
  if (source instanceof ArrayBuffer) return new Blob([source], { type: 'model/gltf-binary' });
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return new Blob([copy], { type: 'model/gltf-binary' });
  }
  return invalid('Submit a GLB Blob, File, ArrayBuffer, byte view, or { file } package');
}

function settings(value: Record<string, unknown>): void {
  if (!record(value.world) || !record(value.bake)) invalid('LightBaker metadata requires world and bake settings');
  const world = value.world as Record<string, unknown>, bake = value.bake as Record<string, unknown>;
  if (typeof world.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(world.color)) invalid('Invalid world color');
  const range = (n: unknown, min: number, max: number, integer = false) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
      invalid('Invalid LightBaker world/bake setting');
  };
  range(world.intensity, 0, 4);
  range(bake.resolution, 128, 1024, true);
  range(bake.samples, 4, 128, true);
  range(bake.bounces, 0, 4, true);
  if (typeof bake.denoise !== 'boolean') invalid('Invalid denoise setting');
}

/** Envelope/package inspection, not a glTF decoder or a renderer fidelity check. */
export async function inspectScenePackage(input: SceneInput): Promise<ScenePackageInfo> {
  return inspectBlob(packageBlob(input));
}
export async function inspectBlob(blob: Blob): Promise<ScenePackageInfo> {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== buffer.byteLength) invalid('Expected a valid GLB 2.0 header and length');
  let offset = 12, json: unknown;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) invalid('Truncated GLB chunk header');
    const size = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (size % 4 || offset + 8 + size > buffer.byteLength) invalid('Invalid GLB chunk length');
    if (offset === 12 && type !== 0x4e4f534a) invalid('First GLB chunk must be JSON');
    if (type === 0x4e4f534a) {
      if (json !== undefined) invalid('Duplicate GLB JSON chunk');
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, offset + 8, size))); }
      catch { invalid('Invalid GLB JSON'); }
    }
    offset += 8 + size;
  }
  if (!record(json) || !record(json.asset) || json.asset.version !== '2.0') invalid('Expected glTF asset version 2.0');
  for (const key of ['buffers', 'images']) {
    const entries = json[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) invalid(`Invalid glTF ${key}`);
    for (const entry of entries) {
      if (!record(entry)) invalid(`Invalid glTF ${key} entry`);
      if (entry.uri !== undefined && (typeof entry.uri !== 'string' || !entry.uri.startsWith('data:')))
        invalid('GLB packages must embed buffers and images; external URIs are not supported');
    }
  }
  let version: 1 | 2 | null = null;
  if (json.scenes !== undefined) {
    if (!Array.isArray(json.scenes)) invalid('Invalid glTF scenes');
    const index = json.scene ?? 0;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || !record(json.scenes[index]))
      invalid('Invalid default glTF scene');
    const scene = json.scenes[index] as Record<string, unknown>;
    const metadata = record(scene.extras) ? scene.extras.lightbaker : undefined;
    if (metadata !== undefined) {
      if (!record(metadata) || (metadata.version !== 1 && metadata.version !== 2)) invalid('Unsupported LightBaker scene metadata version');
      settings(metadata);
      version = metadata.version;
    }
  }
  return { byteLength: buffer.byteLength, sceneContractVersion: version };
}
