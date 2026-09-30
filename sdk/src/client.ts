import { LightBakerError, LightBakerHttpError, LightBakerJobError } from './errors.js';
import { LEGACY_CAPABILITIES, jobId, parseArtifacts, parseCapabilities, parseJob, protocol } from './protocol.js';
import { inspectBlob, packageBlob } from './scene.js';
import type { BakeArtifact, BakeJob, BakeOptions, BakeResult, Capabilities, ClientOptions, RequestOptions, SceneInput, WaitOptions } from './types.js';
import { abortError, delay, httpUrl, operation, positiveMs, record } from './utils.js';

export class LightBakerClient {
  private readonly endpoint: string;
  private readonly discovery: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;
  private capabilities: Capabilities | undefined;

  constructor(options: ClientOptions) {
    const endpoint = httpUrl(options.endpoint);
    if (endpoint.search || endpoint.hash) throw new LightBakerError('INVALID_ARGUMENT', 'Endpoint must not have a query or fragment');
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + '/';
    this.endpoint = endpoint.href;
    this.discovery = options.capabilitiesUrl === undefined ? undefined : httpUrl(options.capabilitiesUrl, this.endpoint).href;
    if (this.discovery && new URL(this.discovery).origin !== endpoint.origin)
      throw new LightBakerError('INVALID_ARGUMENT', 'Capability discovery must use the API origin');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = positiveMs(options.requestTimeoutMs ?? 30_000, 'requestTimeoutMs');
  }

  /** Cached after successful negotiation. Explicit discovery failures never fall back silently. */
  async getCapabilities(options: RequestOptions = {}): Promise<Capabilities> {
    if (options.signal?.aborted) throw abortError(options.signal);
    if (this.capabilities) return this.capabilities;
    if (!this.discovery) return LEGACY_CAPABILITIES;
    const capabilities = parseCapabilities(await this.json(this.discovery, {}, options.signal));
    this.capabilities = capabilities;
    return capabilities;
  }

  async bakeScene(scene: SceneInput, options: BakeOptions = {}): Promise<BakeJob> {
    const quality = options.quality ?? 'preview';
    if (quality !== 'preview' && quality !== 'production') throw new LightBakerError('INVALID_ARGUMENT', 'Unknown quality preset');
    // Snapshot byte views before any await. Metadata and authored assets are never rewritten.
    const blob = packageBlob(scene);
    return operation(options.signal, this.requestTimeoutMs, async signal => {
      const capabilities = await this.getCapabilities({ signal });
      if (blob.size > capabilities.maxSceneBytes) throw new LightBakerError('INVALID_SCENE', `GLB exceeds ${capabilities.maxSceneBytes} bytes`);
      const info = await inspectBlob(blob);
      if (capabilities.sceneContractVersions !== null && (info.sceneContractVersion === null
        || !capabilities.sceneContractVersions.includes(info.sceneContractVersion)))
        throw new LightBakerError('INCOMPATIBLE_VERSION', 'GLB scene metadata is missing or unsupported by the service');
      if (signal.aborted) throw abortError(signal);
      return parseJob(await this.json(this.url(`bakeScene?quality=${quality}`), {
        method: 'POST', headers: { 'content-type': 'model/gltf-binary' }, body: blob,
      }, signal));
    });
  }

  async getJob(id: string, options: RequestOptions = {}): Promise<BakeJob> {
    jobId(id);
    await this.getCapabilities(options);
    return parseJob(await this.json(this.url(`getJob/${id}`), {}, options.signal), id);
  }

  async getArtifacts(id: string, options: RequestOptions = {}): Promise<readonly BakeArtifact[]> {
    jobId(id);
    await this.getCapabilities(options);
    return parseArtifacts(await this.json(this.url(`getArtifacts/${id}`), {}, options.signal), this.endpoint);
  }

  async wait(id: string, options: WaitOptions = {}): Promise<BakeResult> {
    jobId(id);
    const interval = positiveMs(options.pollIntervalMs ?? 1200, 'pollIntervalMs');
    const timeout = positiveMs(options.timeoutMs ?? 600_000, 'timeoutMs');
    return operation(options.signal, timeout, async signal => {
      for (;;) {
        const job = await this.getJob(id, { signal });
        options.onProgress?.({ ...job });
        if (signal.aborted) throw abortError(signal);
        if (job.status === 'failed' || job.status === 'cancelled') throw new LightBakerJobError(job);
        if (job.status === 'completed') {
          const artifacts = await this.getArtifacts(id, { signal });
          if (!artifacts.length) protocol('Completed job has no artifacts');
          return { job: { ...job, status: 'completed' }, artifacts };
        }
        await delay(interval, signal);
      }
    });
  }

  /** Remote cancellation is opt-in through an explicitly advertised capability. */
  async cancel(id: string, options: RequestOptions = {}): Promise<BakeJob> {
    jobId(id);
    const capabilities = await this.getCapabilities(options);
    if (!capabilities.cancellation) throw new LightBakerError('UNSUPPORTED_CAPABILITY', 'This service does not support remote cancellation');
    return parseJob(await this.json(this.url(`cancelJob/${id}`), { method: 'POST' }, options.signal), id);
  }

  /** Downloads bytes; never interprets or mounts a lightmap into a scene. */
  async downloadArtifact(artifact: BakeArtifact, options: RequestOptions = {}): Promise<Blob> {
    if (!record(artifact) || typeof artifact.url !== 'string' || !artifact.url)
      throw new LightBakerError('INVALID_ARGUMENT', 'Expected an artifact descriptor with a URL');
    const url = httpUrl(artifact.url, this.endpoint);
    return this.request(url.href, {}, options.signal, response => response.blob());
  }

  private url(path: string): string { return new URL(path, this.endpoint).href; }
  private json(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    return this.request(url, init, signal, async response => {
      try { return await response.json() as unknown; }
      catch (cause) {
        if (cause instanceof SyntaxError) return protocol('Expected a JSON response');
        throw cause;
      }
    });
  }
  private request<T>(url: string, init: RequestInit, parent: AbortSignal | undefined, decode: (response: Response) => Promise<T>): Promise<T> {
    return operation(parent, this.requestTimeoutMs, async signal => {
      try {
        const response = await this.fetcher(url, { ...init, credentials: 'omit', signal });
        if (!response.ok) {
          let message = `LightBaker HTTP ${response.status}`;
          try {
            const body: unknown = await response.json();
            if (record(body) && typeof body.error === 'string') message += `: ${body.error}`;
          } catch { /* Non-JSON error responses retain the HTTP status. */ }
          throw new LightBakerHttpError(response.status, message);
        }
        return await decode(response);
      } catch (cause) {
        if (signal.aborted) throw abortError(signal);
        if (cause instanceof LightBakerError) throw cause;
        throw new LightBakerError('NETWORK_ERROR', 'LightBaker request failed', { cause });
      }
    });
  }
}
