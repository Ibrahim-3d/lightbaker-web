/** A self-contained glTF 2.0 binary package, never an in-process scene graph. */
export type SceneBytes = Blob | ArrayBuffer | ArrayBufferView;
export type SceneInput = SceneBytes | { file: SceneBytes };
export type Quality = 'preview' | 'production';
export interface RequestOptions { signal?: AbortSignal }
export interface BakeOptions extends RequestOptions { quality?: Quality }

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface BakeJob {
  id: string;
  status: JobStatus;
  /** Percentage in [0, 100]. Missing means unknown, not zero. */
  progress?: number;
  error?: string;
}
export interface BakeArtifact {
  kind: 'preview' | 'lightmap' | 'scene' | (string & {});
  name: string;
  /** Absolute HTTP(S) URL, resolved against the configured endpoint. */
  url: string;
  /** Only present when supplied by the service; never guessed from a filename. */
  mediaType?: string;
}
export interface BakeResult {
  job: BakeJob & { status: 'completed' };
  artifacts: readonly BakeArtifact[];
}
export interface WaitOptions extends RequestOptions {
  pollIntervalMs?: number;
  /** Total deadline, including requests, delays and artifact discovery. Default 10 minutes. */
  timeoutMs?: number;
  onProgress?: (job: BakeJob) => void;
}
export interface ClientOptions {
  endpoint: string;
  /** Optional explicit discovery URL. Unset uses the existing unversioned API conservatively. */
  capabilitiesUrl?: string;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
/** Optional discovery extension. Not implemented by the current platform API. */
export interface CapabilityDocument {
  apiVersions: readonly string[];
  sceneContractVersions: readonly number[];
  formats: readonly string[];
  cancellation: boolean;
  maxSceneBytes?: number;
  /** Outcome/authoring features only; absence is not proof of interpretation. */
  features?: readonly string[];
}
export interface Capabilities {
  apiVersion: '1';
  source: 'legacy' | 'negotiated';
  sceneContractVersions: readonly (1 | 2)[] | null;
  formats: readonly ['glb'];
  cancellation: boolean;
  maxSceneBytes: number;
  features: readonly string[] | null;
}

export interface WorldSettings { color: string; intensity: number }
export interface BakeSettings { resolution: number; samples: number; bounces: number; denoise: boolean }
export interface CameraMetadata { position: number[]; target: number[]; fov: number }
export interface ViewMetadata extends CameraMetadata {
  near: number; far: number; mode: string; grid: boolean; axes: boolean;
  flySpeed: number; postFX: Record<string, unknown>;
}
export interface SceneMetadata {
  version: 1 | 2;
  world: WorldSettings;
  bake: BakeSettings;
  view?: ViewMetadata;
}
export interface MeshMetadata { receive: boolean; contribute: boolean; density: number }
type LightBase = { color: string; intensity: number };
export type LightMetadata =
  | (LightBase & { type: 'area'; width: number; height: number })
  | (LightBase & { type: 'directional' })
  | (LightBase & { type: 'point'; distance: number; decay: number })
  | (LightBase & { type: 'spot'; distance: number; decay: number; angle: number; penumbra: number });
export interface NodeMetadata {
  studioId?: string;
  lightbakerVisible?: boolean;
  lightbakerMesh?: MeshMetadata;
  lightbakerLight?: LightMetadata;
}
export interface ScenePackageInfo { byteLength: number; sceneContractVersion: 1 | 2 | null }
