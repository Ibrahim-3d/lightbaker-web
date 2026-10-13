# Historical pre-v2 handoff — superseded

This retained checkpoint predates the v2 baked-radiance and shared-atlas contracts. Its receiver/pixel limits, native-GPU status and next actions are historical. Read the current docs/LUMEN-HANDOFF.md instead.

# Studio to Lumen handoff

Studio's **Export scene GLB** is the authored bake input. It retains lights,
world/bake settings, visibility, mesh policy and stable `studioId` metadata.
`requestBake` submits those exact GLB bytes to the configured `/bakeScene`
platform API. That action is separate from Lumen delivery and does not prove
execution by the private WebGPU baker.

**Export Lumen geometry GLB** creates a separate mesh-only source file from a
snapshot. It preserves source `studioId` node metadata, geometry, materials,
transforms and hidden geometry, while omitting lights, cameras and Studio bake
policy. It requires at least one mesh with positions, normals and one standard
PBR material. Feed this file to Lumen's offline asset-package compiler and
use Lumen's compiler validation for its stricter glTF limits. The exported GLB
is an input, not an optimized client package or a baked lighting result.
The Bake inspector shows how many current source meshes have structurally valid
UV1 and offers this export without requiring a configured platform API.
Export both this source and the full authored bake GLB while the Studio scene
is unchanged. The two files have different purposes and are not a verified
pair if the scene changes between downloads.

An authored `uv1` attribute is preserved by the export as glTF `TEXCOORD_1`.
Studio does not generate or unwrap UV1. If a Lumen-targeted lightmap needs a
new UV1 layout, prepare it on the authored source **before** Lumen compiles the
geometry, then compile and bake from that same prepared geometry. Remeshing or
repacking UVs after the compiled GLB exists breaks primitive correspondence.

The full authored scene and geometry-only input use different GLBs. The Lumen
compiler records the geometry-only input SHA-256/size in `scene.json.source`
and the compiled GLB SHA-256/size in `scene.json.geometry`.
The private `lightbaker-platform/packages/webgpu` module provides the local
`prepareLumenSourceGLB` helper for authored Three scenes missing UV1, and
`bakeLumenCompiledGLB` for the exact `geometry.glb` produced by Lumen's asset
package compiler. The first helper needs an in-memory scene and browser xatlas
worker, so Studio's downloaded GLB must be loaded into that private authoring
environment before preparation. The bake helper must receive the exact
compiled GLB bytes, not a Studio export or regenerated mesh. Its output is a
refined indirect-only transfer with compiled primitive bindings; Lumen's
`attach-baker-transfer.mjs` validates it when building a new package. No
private WebGPU module is imported into this public Studio application.

An authoring host may call `registerLumenDeliveryAdapter` from
`src/lumen-delivery.ts` with a private adapter. The Bake inspector then enables
**Bake compiled geometry…**. Select both `scene.json` and `geometry.glb` from
the same Lumen package. Studio re-exports current geometry-only GLB and
compares its exact bytes' hash and size with `scene.json.source`; it also
checks the selected compiled GLB against `scene.json.geometry`. Missing,
stale or mismatched provenance stops before the private adapter runs. Studio
snapshots the full authored scene to GLB and passes those bytes, the selected
compiled bytes and an abort signal to the adapter. The
adapter must load the authored GLB for lights/settings and invoke the private
WebGPU `bakeLumenCompiledGLB` against the compiled bytes. Studio checks the
returned transfer format, indirect-only claims and SHA-256 against the selected
bytes before downloading `lumen-indirect-transfer.json`. The Lumen attach CLI
performs the authoritative atlas/binding validation. Studio re-exports both
the source and full authored scene after baking, so geometry, UV, material,
texture, light or bake-setting edits discard a stale transfer. Disposal aborts
the request. This is a host-neutral consistency check against a local compiler
manifest, not an authenticated signature: an attacker able to forge both the
manifest and compiled artifact can forge the claim. A controlled compile or
independently verifiable transformation is required for adversarial proof. The public build has
no adapter installed, so this button stays disabled there.

The optional local host may additionally provide `compile` and `attach` on
the adapter. Studio then enables **Build local walkthrough**. It sends its
current mesh-only source to the local compiler. When UV1 is absent, the private
host must first supply `prepareSource`, which unwraps the authored source
before compilation; Studio separately tracks the raw authored source for edit
freshness and checks compiler provenance against the exact prepared bytes.
It verifies the returned manifest
against both the source and compiled GLB, passes that exact compiled GLB and
the full authored GLB to the private WebGPU baker, and checks the indirect-only
transfer before asking the local host to attach it. Studio checks both exports
again after compile, before attach and after attach. It only offers the
same-origin finished walkthrough link when those checks pass. The local host
owns compiler and package files; the public Studio bundle only knows this
optional interface. Source edits during delivery invalidate the result.
The local action has its own atlas resolution, defaulting to 128 px per
compiled node/primitive receiver. It does not change the general platform
bake preset or the offline transfer action. Studio counts receivers from the
returned compiled GLB before starting WebGPU and rejects a choice exceeding
the one-million-pixel sidecar budget or 64-receiver limit. The pixel budget
alone allows up to 244 receivers at 64 px, 61 at 128 px, 15 at 256 px and 3
at 512 px; 1024 px cannot fit one receiver. Studio also detects a resolution
change during delivery and discards the staged job.

Studio's current **Bake on platform** button uses the configured `/bakeScene`
HTTP API. That endpoint does not establish the private WebGPU Lumen path and
its preview/PNG artifacts are not compatible Lumen sidecars. The public
build has no private host installed, so the automated local action stays
disabled there. The two download actions above remain an offline handoff.
Until a compatible transfer is attached,
use Lumen's direct client lighting or other explicitly supported modes.
