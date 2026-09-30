import type { BakeJob } from './types.js';

export type ErrorCode = 'INVALID_ARGUMENT' | 'INVALID_SCENE' | 'HTTP_ERROR' | 'NETWORK_ERROR'
  | 'PROTOCOL_ERROR' | 'UNSUPPORTED_CAPABILITY' | 'INCOMPATIBLE_VERSION'
  | 'JOB_FAILED' | 'JOB_CANCELLED' | 'ABORTED' | 'TIMEOUT';

export class LightBakerError extends Error {
  constructor(public readonly code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class LightBakerHttpError extends LightBakerError {
  constructor(public readonly status: number, message: string) { super('HTTP_ERROR', message); }
}
export class LightBakerJobError extends LightBakerError {
  constructor(public readonly job: BakeJob) {
    super(job.status === 'cancelled' ? 'JOB_CANCELLED' : 'JOB_FAILED', job.error || `Job ${job.id} ${job.status}`);
  }
}
