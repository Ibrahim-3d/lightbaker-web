import { LightBakerClient, LightBakerError } from '@lightbaker/sdk';

/** Use an exported Studio GLB File. Keep scene identity/invalidation in the editor. */
export async function bakeFile(file: File, endpoint: string, signal: AbortSignal) {
  const client = new LightBakerClient({ endpoint });
  try {
    const job = await client.bakeScene({ file }, { signal });
    return await client.wait(job.id, { signal, onProgress: job => console.log(job.status, job.progress) });
  } catch (error) {
    if (error instanceof LightBakerError) console.error(error.code, error.message);
    throw error;
  }
}
