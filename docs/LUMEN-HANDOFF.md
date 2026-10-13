# Current Studio to Lumen handoff

Studio is scene authoring and orchestration. Lumen owns reusable realtime rendering; LightBaker is an optional private static baking service; `lumen-shipping` is the permanent client application. Read `../../lumen-workspace/README.md` for the current cross-project map, decisions and acceptance. The [pre-v2 handoff](history/LUMEN-HANDOFF-pre-v2.md) is historical.

## Two preview responsibilities

The editable Three.js viewport is a fast authoring preview. Its ambient lighting, helpers, postprocessing and display settings are not a prediction of physical baked output. Preserve it. A high-fidelity Lumen preview must consume the actual versioned Lumen runtime and prepared scene package, sharing runtime behavior with shipping. The existing completed-walkthrough link opens a runtime consumer; it is not an embedded editable Lumen viewport.

## Authored source and exact compiled geometry

**Export scene GLB** exports the complete authored snapshot: geometry, material data, lights, world/bake settings, visibility and stable source metadata. **Export Lumen geometry GLB** exports a separate mesh-only compiler input preserving source IDs, materials, transforms and authored UV1. These GLBs serve different purposes and must come from an unchanged authored snapshot.

The compiler records the exact geometry-source SHA-256 and byte length in `scene.json.source`, independently from `scene.json.geometry`. Select matching manifest and compiled GLB files. Studio compares its current source and selected compiled bytes before calling any delivery adapter. This consistency check is not cryptographic authentication of an untrusted compiler.

When UV1 is missing or needs preparation, the private host prepares source before compilation. Studio tracks the raw authoring source for edit freshness separately from the exact prepared bytes used as compiler input. UVs and geometry must not change after the compiler assigns exact primitive identities and geometry hash. Supported static instances expand before compilation; this is not general compiled GPU-instancing support.

## Host-neutral delivery

`registerLumenDeliveryAdapter` is the optional public interface. The private host implements preparation, compilation, bake and attachment; the public Studio never imports private GPU transport, shaders or worker internals. Without a registered host these actions remain disabled while ordinary authoring/export still works.

**Bake compiled geometry…** validates selected `scene.json` and `geometry.glb`, snapshots authored lighting, runs the adapter on exact compiled bytes, validates the returned transfer and offers a local download. **Build local walkthrough** additionally runs registered compile/attach methods and offers a same-origin finished link only after freshness and provenance checks pass. Edits or disposal invalidate pending results; a successful older bake does not certify newer content.

The transfer is `lightbaker-lumen-lighting-v2`, refined indirect plus a separate first-hit mesh/sky radiance channel. It excludes analytic direct lights. Required claims are `compiled-glb-exact`, `indirect-plus-baked-radiance`, `bakedRadianceIncluded: true`, `directLightingIncluded: false`, `linear-irradiance-f32-rgb`, `uv-v-zero`, UV1 and `refined: true`. Lumen attachment independently validates atlas arrays, exact bindings and package hashes. It emits lighting sidecar v2; legacy v1 playback requires rebaking.

Current allocation limits are 10,000 primitive bindings, 64 atlases and 4,194,304 total pixels. Shared atlases separate receiver count from atlas count. The local resolution control offers 64–2048; budget checks use compiled geometry and the actual layout. The older 64-receiver/one-million-pixel limit is superseded. The general remote bake settings remain their separate public API contract.

## Separate remote bake and client playback

**Bake on platform** uses `/bakeScene`, `/getJob/:id` and `/getArtifacts/:id`. Its preview/PNG artifacts are not Lumen sidecars and do not attest use of the private WebGPU Lumen path. Do not advertise equivalent pipelines because both buttons contain the word bake.

The private bridge may generate immutable walkthrough evidence using Lumen's starter. Product UI and reusable scene selection belong in the independent shipping application, consuming `@lumen/client-runtime`; do not copy a presentation renderer into Studio. Shipping normal URLs expose client controls; diagnostics require `?debug`.

## Evidence

Unit tests validate allocation/lighting claims and public-private boundaries; browser tests exercise preparation routing, provenance, cancellation and stale-result rejection. The actual local native GPU path has retained RTX evidence in the private platform. Current run results belong in the workspace status. Automated delivery and native success do not establish human visual approval. Compare realtime Lumen to the visual references, baked Lumen to scene lighting requirements, and the editor to its documented authoring limitations.
