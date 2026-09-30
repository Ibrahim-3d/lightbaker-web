# Public API

```ts
const client = new LightBakerClient({
  endpoint: 'http://127.0.0.1:8787',
  // requestTimeoutMs: 30_000,
  // fetch: customFetch,
  // capabilitiesUrl: 'capabilities', // only on a service implementing that extension
});
```

Endpoint must be an absolute HTTP(S) URL without credentials, query or fragment. A path prefix is supported. Configuration is per client; no global state, secrets, GPU objects or worker configuration exist in this API.

| Method | Result | Purpose |
| --- | --- | --- |
| `bakeScene(scene, { quality?, signal? })` | `Promise<BakeJob>` | Validate/snapshot a package and submit it once |
| `getJob(id, { signal? })` | `Promise<BakeJob>` | Read current state/progress |
| `wait(id, { signal?, timeoutMs?, pollIntervalMs?, onProgress? })` | `Promise<BakeResult>` | Poll to success and retrieve artifact descriptors |
| `getArtifacts(id, { signal? })` | `Promise<readonly BakeArtifact[]>` | Discover artifacts; pending jobs may return `[]` |
| `downloadArtifact(artifact, { signal? })` | `Promise<Blob>` | Fetch an artifact's bytes |
| `getCapabilities({ signal? })` | `Promise<Capabilities>` | Read conservative legacy facts or explicit discovery |
| `cancel(id, { signal? })` | `Promise<BakeJob>` | Request remote cancellation only when negotiated |
| `inspectScenePackage(scene)` | `Promise<ScenePackageInfo>` | Standalone package envelope/metadata inspection |

`SceneInput` accepts a `Blob`/`File`, `ArrayBuffer`, any byte view (including Node Buffer), or `{ file: SceneBytes }`. Views respect byte offset/length. Mutable bytes are copied before the first await. The SDK does not own or mutate the author's graph.

`quality` is `preview` (default) or `production`. This selects the legacy query fallback. Explicit GLB metadata settings take precedence in the service; the SDK never rewrites them.

`BakeJob` has opaque `id`, `status` (`queued`, `running`, `completed`, `failed`, `cancelled`), optional `progress` (percentage 0–100), and optional service `error` string. Missing progress means unknown. Progress may be coarse, and status/progress must not be assumed to advance at a fixed rate. The current prototype typically reports 0, 10, 100. `cancelled` is a reserved terminal extension; the current remote API only emits the first four states.

`BakeResult` contains a completed `job` and `artifacts`. `wait` fails for a failed/cancelled job or a completed job returning no artifacts. It does not download all images automatically. `onProgress` is called for each observed state, including completion, with a copy so callback edits cannot alter SDK control flow. Callback exceptions propagate unchanged and stop local polling.

Each request has a 30-second default deadline covering headers and body. `bakeScene` also bounds package preparation/discovery. `wait` has a total 10-minute default deadline covering polling requests, delays and artifact discovery, with a 1200ms polling interval. All durations must be finite, positive, and at most 2147483647ms. Per-request deadlines still apply within `wait`. The SDK releases its timers/listeners when an operation ends. It makes no automatic retries: retrying an upload after a lost response could create a duplicate job because the existing API has no idempotency token.

## Errors

All SDK/transport/service failures extend `LightBakerError` and have a stable `code`. Consumer callback exceptions are preserved.

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid endpoint, duration, quality, identifier or download URL |
| `INVALID_SCENE` | Invalid GLB envelope/metadata, external assets or oversized package |
| `HTTP_ERROR` | Non-success response; `LightBakerHttpError.status` contains HTTP status |
| `NETWORK_ERROR` | Fetch/response transport failure; original error is `cause` |
| `PROTOCOL_ERROR` | Invalid success JSON, job ID/state/progress, artifacts or discovery document |
| `UNSUPPORTED_CAPABILITY` | Operation not advertised/supported |
| `INCOMPATIBLE_VERSION` | No shared API/format/scene version or unsupported submitted metadata |
| `JOB_FAILED` | Remote bake failed; `LightBakerJobError.job` has the service result |
| `JOB_CANCELLED` | Service reported a cancelled job; same typed job context |
| `ABORTED` | Caller aborted the local operation |
| `TIMEOUT` | Local request/operation deadline elapsed |

```ts
import { LightBakerError, LightBakerHttpError, LightBakerJobError } from '@lightbaker/sdk';
try {
  await client.wait(job.id);
} catch (error) {
  if (error instanceof LightBakerHttpError) console.error(error.status);
  if (error instanceof LightBakerJobError) console.error(error.job);
  if (error instanceof LightBakerError) console.error(error.code, error.message);
  throw error;
}
```

## Cancellation

An `AbortSignal` stops local upload/poll/download work. If submission already reached the service, a remote job may continue even if the client never received its ID. Timeouts have the same uncertainty. No cancellation request is sent implicitly.

The current API has no cancellation operation. `cancel(id)` returns `UNSUPPORTED_CAPABILITY` without posting anything. Only an explicitly discovered service advertising `cancellation: true` enables the optional cancellation extension. A cancellation response may remain queued/running while cancellation is pending, or may already be completed; acknowledgement is not a guarantee of a cancelled terminal outcome. Poll the returned job's ID to inspect the actual state. A service falsely advertising cancellation receives a normal HTTP/protocol error; the SDK cannot manufacture backend support.
