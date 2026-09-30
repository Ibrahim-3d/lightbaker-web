import { LightBakerError } from './errors.js';
import type { BakeArtifact, BakeJob, Capabilities } from './types.js';
import { httpUrl, record } from './utils.js';

export function protocol(message: string): never { throw new LightBakerError('PROTOCOL_ERROR', message); }
export function jobId(id: string): string {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,255}$/i.test(id))
    throw new LightBakerError('INVALID_ARGUMENT', 'Expected a nonempty opaque job ID');
  return id;
}
export function parseJob(value: unknown, expectedId?: string): BakeJob {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,255}$/i.test(value.id)
    || (expectedId !== undefined && value.id !== expectedId)
    || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(String(value.status)))
    return protocol('Invalid job response or mismatched job ID');
  if (value.progress !== undefined && (typeof value.progress !== 'number' || !Number.isFinite(value.progress)
    || value.progress < 0 || value.progress > 100)) protocol('Invalid job progress');
  if (value.error !== undefined && typeof value.error !== 'string') protocol('Invalid job error');
  return {
    id: value.id, status: value.status as BakeJob['status'],
    ...(value.progress === undefined ? {} : { progress: value.progress as number }),
    ...(value.error === undefined ? {} : { error: value.error as string }),
  };
}
export function parseArtifacts(value: unknown, base: string): BakeArtifact[] {
  if (!Array.isArray(value)) return protocol('Expected an artifact array');
  return value.map((entry: unknown) => {
    if (!record(entry) || typeof entry.kind !== 'string' || !entry.kind || typeof entry.name !== 'string' || !entry.name
      || typeof entry.url !== 'string' || !entry.url || (entry.mediaType !== undefined && typeof entry.mediaType !== 'string'))
      return protocol('Invalid artifact descriptor');
    let url: URL;
    try { url = httpUrl(entry.url, base); } catch { return protocol('Artifact URL must be HTTP(S) without embedded credentials'); }
    return { kind: entry.kind, name: entry.name, url: url.href,
      ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType as string }) };
  });
}
export const LEGACY_CAPABILITIES: Capabilities = Object.freeze({
  apiVersion: '1', source: 'legacy', sceneContractVersions: null,
  formats: Object.freeze(['glb'] as const), cancellation: false,
  maxSceneBytes: 25 * 1024 * 1024, features: null,
});
export function parseCapabilities(value: unknown): Capabilities {
  if (!record(value) || !Array.isArray(value.apiVersions) || !value.apiVersions.every(x => typeof x === 'string')
    || !Array.isArray(value.sceneContractVersions) || !value.sceneContractVersions.every(x => Number.isInteger(x) && x > 0)
    || !Array.isArray(value.formats) || !value.formats.every(x => typeof x === 'string')
    || typeof value.cancellation !== 'boolean'
    || (value.maxSceneBytes !== undefined && (!Number.isSafeInteger(value.maxSceneBytes) || Number(value.maxSceneBytes) <= 0))
    || (value.features !== undefined && (!Array.isArray(value.features) || !value.features.every(x => typeof x === 'string'))))
    return protocol('Invalid capability document');
  if (!value.apiVersions.includes('1') || !value.formats.includes('glb'))
    throw new LightBakerError('INCOMPATIBLE_VERSION', 'Service must support product API 1 and GLB packages');
  const versions = value.sceneContractVersions.filter((x): x is 1 | 2 => x === 1 || x === 2);
  if (!versions.length) throw new LightBakerError('INCOMPATIBLE_VERSION', 'No common LightBaker scene metadata version');
  return Object.freeze({ apiVersion: '1', source: 'negotiated', formats: Object.freeze(['glb'] as const),
    sceneContractVersions: Object.freeze(versions), cancellation: value.cancellation,
    maxSceneBytes: value.maxSceneBytes === undefined ? LEGACY_CAPABILITIES.maxSceneBytes : Number(value.maxSceneBytes),
    features: value.features === undefined ? null : Object.freeze([...value.features as string[]]),
  });
}
