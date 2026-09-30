# M3 decisions and evidence

This SDK was authored independently after inspecting the canonical M3 roadmap, current API/backend status, WebGPU supported scene/output scope, public Studio authoring contract, serializer and provider integration. Only public scene/job/artifact schemas informed the implementation. No platform renderer, shader, worker, transport algorithm, geometry preparation, BVH, refinement or private scheduler source is included.

## Repository/package boundary

An independently buildable public package avoids sharing builds/history/dependencies with the proprietary platform. It lives in `lightbaker-web/sdk` without changing Studio's application integration. A standalone `lightbaker-sdk` repository was attempted, but both GraphQL and REST repository creation were denied by the connected GitHub integration (403). This public package keeps the intended distribution boundary and can move unchanged to a dedicated repository later.

One ESM TypeScript package, zero runtime dependencies, native fetch/Blob/AbortSignal, and an allowlisted package payload keep browser adoption simple. The entry exports one client, one package-inspection helper, typed errors, and product types. There are no renderer selection flags, GPU option bags, local bake hooks, shader exports or internal diagnostics.

The SDK retains getJob/getArtifacts for resumable workflows and Studio compatibility, while wait owns ordinary poll/deadline/error handling. Submission remains GLB because that is the genuine backend contract. The SDK does not invent a JSON scene schema, multipart assets endpoint, archive upload or renderer-aware Three adapter.

Optional discovery and cancellation are explicitly documented extensions rather than assumed backend routes. Legacy unknown capabilities remain unknown. Conservative fallback facts come from the current API: raw GLB, the upload byte limit, known job states, and current PNG descriptors. No claim about native transport fidelity follows from SDK success.

## Validation

- Strict TypeScript builds/declarations and public-API usage/negative type assertions.
- Independent HTTP reference service exercising raw bytes, content type, query fallback, opaque IDs, coarse progress, pending/completed artifacts and placeholder PNG downloads.
- Unit contracts covering invalid GLB/chunks/UTF-8/JSON/settings/assets, unknown metadata, discovery incompatibilities, malformed responses, typed HTTP/network/job failures, local abort during operations/delay, total/per-request deadlines and no upload retries.
- Real Chromium importing built ESM modules, cross-origin CORS/File submission, wait callbacks, Blob download and image decode, local abort with typed error. No rendering/GPU dependency is used by the SDK.
- Dry-run package inspection rejecting unallowlisted files and renderer dependency/implementation markers in generated code; zero runtime dependencies.
- Runnable authored room → mock job → descriptor → byte-download reference flow.
- Repository-level Studio compatibility test using the actual current serializer, SDK submission and reference job/artifact responses; independent SDK build/test scope stays outside Studio's application source globs.

Tests do not assert shader correctness, remote WebGPU execution, backend cancellation, Studio migration, hosting reliability or every glTF extension. Those need the private platform and later M4/M5 work. The mock deliberately labels its artifacts as placeholders.
