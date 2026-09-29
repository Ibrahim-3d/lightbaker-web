/** Public product contract. The engine and worker implementation live outside this repository. */
export interface SceneInput {
  file: File;
}

export interface BakeOptions {
  quality?: 'preview' | 'production';
}

export interface BakeJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  error?: string;
}

export interface BakeArtifact {
  kind: 'preview' | 'lightmap' | 'scene';
  url: string;
  name: string;
}

export interface BakeProvider {
  bakeScene(scene: SceneInput, options?: BakeOptions): Promise<BakeJob>;
  getJob(id: string): Promise<BakeJob>;
  getArtifacts(id: string): Promise<BakeArtifact[]>;
}

/** Cloud adapter: accepts an editor-exported GLB and returns only job and artifact data. */
export class ApiBakeProvider implements BakeProvider {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, init);
    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { error?: string };
        detail = body.error ? `: ${body.error}` : '';
      } catch {
        // Keep the status-only error when the response is not JSON.
      }
      throw new Error(`LightBaker API error (${response.status})${detail}`);
    }
    return response.json() as Promise<T>;
  }

  bakeScene(scene: SceneInput, options: BakeOptions = {}): Promise<BakeJob> {
    const quality = encodeURIComponent(options.quality ?? 'preview');
    return this.request<BakeJob>(`/bakeScene?quality=${quality}`, {
      method: 'POST',
      headers: { 'content-type': 'model/gltf-binary' },
      body: scene.file,
    });
  }

  getJob(id: string): Promise<BakeJob> {
    return this.request<BakeJob>(`/getJob/${encodeURIComponent(id)}`);
  }

  getArtifacts(id: string): Promise<BakeArtifact[]> {
    return this.request<BakeArtifact[]>(`/getArtifacts/${encodeURIComponent(id)}`);
  }
}

export const apiUrl = import.meta.env.VITE_LIGHTBAKER_API_URL || 'http://127.0.0.1:8787';
export const provider: BakeProvider = new ApiBakeProvider(apiUrl);
