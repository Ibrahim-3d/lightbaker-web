import { signal } from '@preact/signals';

/** Optional private host capability. The public Studio bundle never imports a baker. */
export interface LumenDeliveryAdapter {
  /** Private authoring-only UV unwrap before compilation when source UV1 is absent. */
  prepareSource?(request: {
    sourceGlb: ArrayBuffer;
    atlasResolution: number;
    signal: AbortSignal;
  }): Promise<ArrayBuffer>;
  /** Local authoring host compiles the exact Studio source into a staged package. */
  compile?(request: {
    sourceGlb: ArrayBuffer;
    signal: AbortSignal;
  }): Promise<{ jobId: string; manifestBytes: ArrayBuffer; compiledGlb: ArrayBuffer }>;
  bake(request: {
    compiledGlb: ArrayBuffer;
    authoredGlb: ArrayBuffer;
    /** Validated compiler input SHA, when a local attached package is requested. */
    sourceSha256?: string;
    /** Local Lumen atlas setting; omitted for the existing offline handoff. */
    atlasResolution?: number;
    signal: AbortSignal;
  }): Promise<unknown>;
  /** Host attaches a validated indirect transfer to that staged package. */
  attach?(request: {
    jobId: string;
    transfer: Record<string, unknown>;
    directLighting?: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<{ walkthroughUrl: string; packagePath?: string }>;
  /** Remove this isolated local job when Studio rejects or aborts delivery. */
  discard?(request: { jobId: string }): Promise<void>;
}

export const lumenDeliveryAdapter = signal<LumenDeliveryAdapter | null>(null);
export const lumenDeliveryBusy = signal(false);
export const lumenWalkthroughUrl = signal<string | null>(null);
/** Local Lumen atlas size is independent of Studio's general platform bake preset. */
export const lumenAtlasResolution = signal(128);
export const lumenAtlasResolutions = [64, 128, 256, 512, 1024, 2048] as const;

/** Bound receiver identities before preparation. The private baker validates decoded
 * UV overlap and exact atlas/pixel budgets; receiver count is not texture count. */
export function validateLumenAtlasBudget(compiledGlb: ArrayBuffer, resolution: number): number {
  if (!lumenAtlasResolutions.includes(resolution as (typeof lumenAtlasResolutions)[number]))
    throw new Error('Local Lumen atlas resolution must be 64, 128, 256, 512, 1024 or 2048');
  if (compiledGlb.byteLength < 28 || compiledGlb.byteLength > MAX_GLB_BYTES)
    throw new Error('Compiled Lumen GLB exceeds supported bounds');
  const view = new DataView(compiledGlb);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== compiledGlb.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a || jsonLength < 2 || jsonLength > compiledGlb.byteLength - 20)
    throw new Error('Compiled Lumen atlas budget requires a complete GLB');
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(compiledGlb, 20, jsonLength))); }
  catch { throw new Error('Compiled Lumen atlas budget requires valid glTF JSON'); }
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new Error('Compiled Lumen atlas budget requires valid glTF JSON');
  const scene = json as Record<string, unknown>;
  if (!Array.isArray(scene.nodes) || !Array.isArray(scene.meshes))
    throw new Error('Compiled Lumen atlas budget requires node and mesh arrays');
  let placements = 0;
  for (const node of scene.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node))
      throw new Error('Compiled Lumen atlas budget has an invalid node');
    const mesh = (node as Record<string, unknown>).mesh;
    if (mesh === undefined) continue;
    const selected = Number.isSafeInteger(mesh) && (mesh as number) >= 0
      ? scene.meshes[mesh as number] : undefined;
    if (!selected || typeof selected !== 'object' || Array.isArray(selected) ||
        !Array.isArray((selected as Record<string, unknown>).primitives))
      throw new Error('Compiled Lumen atlas budget has an invalid mesh placement');
    placements += ((selected as Record<string, unknown>).primitives as unknown[]).length;
  }
  if (!placements) throw new Error('Compiled Lumen GLB has no bakeable placements');
  if (placements > 10_000)
    throw new Error(`Lumen geometry has ${placements} node/primitive receivers; the delivery contract supports at most 10000 bindings.`);
  return placements;
}

const sha256Pattern = /^[0-9a-f]{64}$/;
const MAX_GLB_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required for Lumen delivery');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Check the compiler's exact input and output fingerprints before a private bake.
 * The manifest is a local compiler claim, not a signature against a forged package. */
export async function validateCompiledSourceSelection(
  manifestBytes: ArrayBuffer,
  compiledGlb: ArrayBuffer,
  currentSourceGlb: ArrayBuffer,
): Promise<{ sourceSha256: string; geometrySha256: string }> {
  if (manifestBytes.byteLength < 2 || manifestBytes.byteLength > MAX_MANIFEST_BYTES ||
      compiledGlb.byteLength < 28 || compiledGlb.byteLength > MAX_GLB_BYTES ||
      currentSourceGlb.byteLength < 28 || currentSourceGlb.byteLength > MAX_GLB_BYTES)
    throw new Error('Lumen package provenance files exceed supported bounds');
  for (const glb of [compiledGlb, currentSourceGlb]) {
    const header = new DataView(glb);
    if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 ||
        header.getUint32(8, true) !== glb.byteLength || header.getUint32(16, true) !== 0x4e4f534a)
      throw new Error('Lumen package provenance requires complete GLB files');
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); }
  catch { throw new Error('Lumen package scene.json must be valid UTF-8 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Lumen package provenance is missing');
  const manifest = value as Record<string, unknown>;
  const source = manifest.source as Record<string, unknown> | undefined;
  const geometry = manifest.geometry as Record<string, unknown> | undefined;
  const descriptor = (entry: Record<string, unknown> | undefined, filename?: string): entry is Record<string, unknown> =>
    !!entry && typeof entry === 'object' && !Array.isArray(entry) &&
    Object.keys(entry).length === (filename ? 3 : 2) &&
    (!filename || entry.file === filename) &&
    Number.isSafeInteger(entry.byteLength) && (entry.byteLength as number) >= 28 &&
    (entry.byteLength as number) <= MAX_GLB_BYTES &&
    typeof entry.sha256 === 'string' && sha256Pattern.test(entry.sha256);
  if (manifest.format !== 'lumen-asset-scene' || manifest.version !== 1 ||
      manifest.units !== 'meters' || !descriptor(source) || !descriptor(geometry, 'geometry.glb'))
    throw new Error('Lumen package provenance is missing or incompatible');
  if (source.byteLength !== currentSourceGlb.byteLength ||
      geometry.byteLength !== compiledGlb.byteLength)
    throw new Error('Compiled Lumen package does not match the current Studio source or selected geometry');
  const [sourceSha256, geometrySha256] = await Promise.all([sha256(currentSourceGlb), sha256(compiledGlb)]);
  if (source.sha256 !== sourceSha256 || geometry.sha256 !== geometrySha256)
    throw new Error('Compiled Lumen package does not match the current Studio source or selected geometry');
  return { sourceSha256, geometrySha256 };
}

/** A private host can install its WebGPU adapter before using Studio delivery. */
export function registerLumenDeliveryAdapter(adapter: LumenDeliveryAdapter): () => void {
  if (!adapter || typeof adapter.bake !== 'function' || lumenDeliveryAdapter.peek())
    throw new Error('A Lumen delivery adapter is already installed or invalid');
  lumenDeliveryAdapter.value = adapter;
  return () => {
    if (lumenDeliveryAdapter.peek() === adapter) lumenDeliveryAdapter.value = null;
  };
}

/** Minimal fail-closed handoff check; Lumen's attach CLI checks full atlas bindings. */
export async function validateLumenTransfer(value: unknown, compiledGlb: ArrayBuffer): Promise<Record<string, unknown>> {
  const hash = await sha256(compiledGlb);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Private baker did not return a Lumen transfer');
  const transfer = value as Record<string, unknown>;
  if (transfer.format !== 'lightbaker-lumen-lighting-v2' ||
      transfer.geometrySha256 !== hash ||
      transfer.geometryCorrespondence !== 'compiled-glb-exact' ||
      transfer.lightingComponent !== 'indirect-plus-baked-radiance' ||
      transfer.bakedRadianceIncluded !== true ||
      transfer.directLightingIncluded !== false ||
      transfer.encoding !== 'linear-irradiance-f32-rgb' ||
      transfer.rowOrigin !== 'uv-v-zero' ||
      transfer.uvChannel !== 1 || transfer.refined !== true ||
      !Array.isArray(transfer.atlases) || !transfer.atlases.length || transfer.atlases.length > 64 ||
      !Array.isArray(transfer.bindings) || !transfer.bindings.length || transfer.bindings.length > 10_000)
    throw new Error('Private baker transfer is incompatible with the exact compiled geometry or indirect lighting contract');
  // Validate every allocation claim before touching potentially large channel arrays.
  let pixels = 0;
  for (const atlas of transfer.atlases) {
    if (!atlas || typeof atlas !== 'object' || Array.isArray(atlas))
      throw new Error('Private baker transfer has an invalid indirect or baked radiance atlas');
    const value = atlas as Record<string, unknown>;
    const { width, height } = value;
    if (typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1 || width > 4096 ||
        typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1 || height > 4096 ||
        (pixels += width * height) > 2048 * 2048)
      throw new Error('Private baker transfer has an invalid indirect or baked radiance atlas');
    const count = width * height * 3;
    if (
        !Array.isArray(value.rgb) || value.rgb.length !== count ||
        !Array.isArray(value.bakedRadianceRgb) || value.bakedRadianceRgb.length !== count)
      throw new Error('Private baker transfer has an invalid indirect or baked radiance atlas');
  }
  for (const atlas of transfer.atlases) {
    for (const channels of [atlas.rgb, atlas.bakedRadianceRgb]) {
      // Iteration also rejects sparse arrays, whose holes Array.every would skip.
      for (const channel of channels) {
        if (typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 65504)
          throw new Error('Private baker transfer has an invalid indirect or baked radiance atlas');
      }
    }
  }
  return transfer;
}

/** Early local handoff check; Lumen attachment validates every light and file hash. */
export function validateDirectLightingClaim(
  value: unknown, geometrySha256: string, sourceSha256: string, authoredGlbSha256: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Private baker did not return authored direct lighting');
  const direct = value as Record<string, unknown>;
  const keys = ['format', 'version', 'geometrySha256', 'sourceSha256', 'authoredGlbSha256', 'lights'];
  if (Reflect.ownKeys(direct).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(direct, key)) ||
      direct.format !== 'lumen-direct-lighting' || direct.version !== 1 ||
      direct.geometrySha256 !== geometrySha256 || direct.sourceSha256 !== sourceSha256 ||
      direct.authoredGlbSha256 !== authoredGlbSha256 ||
      !Array.isArray(direct.lights) || direct.lights.length > 64 ||
      JSON.stringify(direct).length > 256 * 1024)
    throw new Error('Authored direct lighting does not match the current Studio and compiled geometry');
  return direct;
}
