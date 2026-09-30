# LightBaker SDK

Public TypeScript client for remote scene baking. The SDK uploads authored scene packages, tracks jobs, and returns artifact descriptors/bytes. It has zero runtime dependencies and includes no renderer.

Location: [Ibrahim-3d/lightbaker-web, sdk](https://github.com/Ibrahim-3d/lightbaker-web/tree/m3-public-sdk/sdk). Package: `@lightbaker/sdk` (ESM, TypeScript declarations, MIT). This package builds/tests independently from Studio and has **not been published to npm**.

```sh
git clone --branch m3-public-sdk https://github.com/Ibrahim-3d/lightbaker-web.git
cd lightbaker-web/sdk
npm ci
npm run build
npm pack
# In your app, install the resulting lightbaker-sdk-0.1.0.tgz file.
```

```ts
import { LightBakerClient } from '@lightbaker/sdk';

const client = new LightBakerClient({ endpoint: 'http://127.0.0.1:8787' });
// scene is a self-contained GLB File/Blob, ArrayBuffer, byte view, or { file }.
const job = await client.bakeScene(scene);
const result = await client.wait(job.id);

for (const artifact of result.artifacts) {
  console.log(artifact.kind, artifact.name, artifact.url);
  const bytes = await client.downloadArtifact(artifact); // browser/Node Blob
}
```

The current API is an unversioned prototype with raw GLB submission, percentage progress, and preview/lightmap PNG URLs. It does not advertise scene interpretation capabilities or support remote cancellation. Completion means the service completed its job; it does not certify support for every editor setting. The private WebGPU engine's supported scope is broader than the current remote worker. This SDK does not switch the worker or deploy a service.

Use browser native `fetch`, `Blob`, `File`, and `AbortController`, or Node 20+. Browser consumers need the service and artifact host to permit their origin through CORS. No local GPU or Three.js installation is needed by the SDK. Authentication/account systems are outside this version; a custom `fetch` can adapt an existing application's transport. Credentials are omitted by default, including for external artifact URLs.

```ts
const controller = new AbortController();
const result = await client.wait(job.id, {
  signal: controller.signal,
  timeoutMs: 10 * 60_000,
  pollIntervalMs: 1200,
  onProgress: job => console.log(job.status, job.progress),
});
// controller.abort() stops this local operation. It does not cancel the remote bake.
```

- [Public API, errors and cancellation](docs/api.md)
- [Scene package/serialization contract](docs/scene-contract.md)
- [Artifact contract](docs/artifacts.md)
- [Version and capability negotiation](docs/capabilities.md)
- [M4 Studio integration and backend gaps](docs/studio-integration.md)
- [Design decisions and validation scope](docs/design.md)
- [Browser example](examples/browser.ts) and [runnable reference flow](examples/reference-flow.mjs)

```sh
npx playwright install --with-deps chromium  # or use /usr/bin/chromium
npm run check
npm run example
```

The reference flow submits an authored room GLB to a local mock service, observes running/completed states, retrieves descriptors, and downloads PNG bytes. Mock images are placeholders, not computed lighting. Tests cover HTTP wire compatibility, malformed responses/packages, typed failures, deadlines, local abort, optional discovery/cancellation, TypeScript usage, browser ESM/CORS/File/Blob behavior, and the package boundary. GPU rendering qualification belongs to the private platform.
