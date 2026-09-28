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

const showcase = 'https://raw.githubusercontent.com/Ibrahim-3d/three-lightmap-baker/e73efec8e179689d952c99c2f964aca8ed35b7b5/screenshots/after-production-baked-combined.png';

/** Sample workflow for the public UI until the hosted API is connected. It never bakes the uploaded file. */
export class ShowcaseProvider implements BakeProvider {
  private jobs = new Map<string, BakeJob>();

  async bakeScene(scene: SceneInput): Promise<BakeJob> {
    if (!scene.file.name.toLowerCase().endsWith('.glb')) throw new Error('Choose a .glb scene file.');
    const job: BakeJob = { id: crypto.randomUUID(), status: 'completed', progress: 100 };
    this.jobs.set(job.id, job);
    return job;
  }

  async getJob(id: string): Promise<BakeJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Sample job not found.');
    return job;
  }

  async getArtifacts(id: string): Promise<BakeArtifact[]> {
    await this.getJob(id);
    return [{ kind: 'preview', url: showcase, name: 'Example baked scene' }];
  }
}

/** Cloud adapter: accepts a scene and returns only job and artifact data. */
export class ApiBakeProvider implements BakeProvider {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, init);
    if (!response.ok) throw new Error(`LightBaker API error (${response.status})`);
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

export const provider: BakeProvider = import.meta.env.VITE_LIGHTBAKER_API_URL
  ? new ApiBakeProvider(import.meta.env.VITE_LIGHTBAKER_API_URL)
  : new ShowcaseProvider();
