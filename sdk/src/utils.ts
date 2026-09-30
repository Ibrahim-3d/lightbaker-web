import { LightBakerError } from './errors.js';

export function positiveMs(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647)
    throw new LightBakerError('INVALID_ARGUMENT', `${name} must be > 0 and <= 2147483647`);
  return value;
}
export function abortError(signal: AbortSignal): LightBakerError {
  return signal.reason instanceof LightBakerError ? signal.reason
    : new LightBakerError('ABORTED', 'The local operation was aborted', { cause: signal.reason });
}
/** Own and release a deadline and a parent-signal listener for one public operation. */
export async function operation<T>(parent: AbortSignal | undefined, ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort(parent ? abortError(parent) : undefined);
  if (parent?.aborted) forward();
  else parent?.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new LightBakerError('TIMEOUT', 'LightBaker operation timed out')), ms);
  let rejectAbort: (() => void) | undefined;
  try {
    if (controller.signal.aborted) throw abortError(controller.signal);
    const stopped = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(abortError(controller.signal));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    return await Promise.race([run(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', forward);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function httpUrl(value: string, base?: string): URL {
  let url: URL;
  try { url = new URL(value, base); }
  catch { throw new LightBakerError('INVALID_ARGUMENT', 'Expected an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new LightBakerError('INVALID_ARGUMENT', 'Expected an HTTP(S) URL without embedded credentials');
  return url;
}
