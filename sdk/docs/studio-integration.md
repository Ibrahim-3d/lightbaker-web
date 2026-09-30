# M4 handoff: lightbaker-web

M3 adds the standalone public SDK package at `sdk` and its independent validation workflow, leaving Studio's application/provider/serializer and the private platform untouched. Compatibility was inspected at Studio revision `fffa842a7bea1a4bd0bcf78f9efb32abf553b5f3` and platform revision `9696d97425ce8fa5200ac80e55fd8261323bb651` (2026-09-30).

## Studio changes

1. Add the built `@lightbaker/sdk` package. Until npm publication, install the repository's generated tarball. Replace `ApiBakeProvider` in `src/provider.ts` with a configured `LightBakerClient` and SDK types. Keep `VITE_LIGHTBAKER_API_URL` and the existing no-endpoint UI handling; the SDK requires a valid configured URL.
2. Keep `src/contract.ts` authoring snapshot/GLB export. Its `{ file: new File([buffer], 'studio.glb', ...) }` shape and `exportScene` ArrayBuffer are directly accepted. Continue recording submitted content identity and generation **before** asynchronous export; the SDK does not certify newer edits.
3. In `src/studio.ts::requestBake`, replace the manual polling loop/timer with `client.wait(job.id, { signal, onProgress })`. Assign progress to Studio signals, then use `result.job` and `result.artifacts`. Preserve generation/alive/stale-content checks around result application.
4. Add one `AbortController` per local request flow; abort it on disposal. This stops client work, not the remote job. Extend status handling to include `cancelled` and present typed HTTP/job errors. Enable a remote cancel control only if advertised.
5. Update the old mutable `BakeArtifact[]` provider typing to the SDK's `readonly BakeArtifact[]`, or copy with `[...result.artifacts]` when assigning mutable Studio signals. Filter recognized `kind` values; unknown future kinds should not break the UI.

```ts
import { LightBakerClient } from '@lightbaker/sdk';

const client = new LightBakerClient({ endpoint: apiUrl });
const controller = new AbortController();
const buffer = await exportScene(roots, settings, view); // existing snapshot serializer
const job = await client.bakeScene(buffer, { signal: controller.signal });
const result = await client.wait(job.id, {
  signal: controller.signal,
  onProgress: current => { jobSignal.value = current; },
});
// Existing content/generation guard must run here before marking a bake valid.
artifactsSignal.value = [...result.artifacts];
```

`sdk/tests/public-api.ts` typechecks the Studio file submission shape and public controls; the HTTP/browser tests verify exact GLB byte preservation and transport compatibility. The repository-level `tests/unit/sdk-compatibility.test.ts` exercises the actual current Studio `exportScene` serializer with a mesh and oriented area light, submits its GLB bytes unchanged through the SDK, and verifies job/artifact flow against reference responses. This is SDK compatibility validation, not a migrated Studio or an end-to-end remote WebGPU claim.

## Backend changes required for full M4

The current remote worker still selects the classic reference path. Its acceptance/interpretation is narrower than the completed native engine: it requires an area marker and does not establish native parity for punctual/emissive-only scenes, per-mesh policies, visibility, all materials or multiple native atlases. A successful legacy SDK job does not prove these authored controls worked.

M4 must switch the private worker to the qualified WebGPU entry through private code, preserve full supported Studio GLB v1/v2 interpretation, publish all output atlases plus the necessary geometry/association manifest, and return usable artifact descriptors. Add truthful capability discovery if desired; keep remote cancellation disabled until the **job execution system**, not merely the engine's local AbortSignal support, can cancel jobs. No private renderer modules should become Studio or SDK imports.

Then test the full restored scene corpus through `Studio → SDK → private worker → artifacts → Studio`, including authored lights, mesh overrides, visibility and unsupported-material reporting. Preserve content invalidation across edits/undo/disposal, and verify result geometry/UV/material application. Accounts, billing and hosting are outside this handoff.
