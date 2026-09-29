# Public Studio rehabilitation

Implementation source: `Ibrahim-3d/three-lightmap-baker` at **e73efec8e179689d952c99c2f964aca8ed35b7b5**. The cutoff was fetched into this repository's object store; the legacy checkout was not changed.

## Copied and adapted

- `apps/playground/src/three/SceneController.ts`: selection, picking, transform tools, framing, camera views, scene construction and post-processing architecture.
- `FlyController.ts`, `commands.ts`, public post-FX passes and all twelve preset builders.
- `packages/demo-shell`: App, outliner, Asset Library, scene picker, inspectors, menus, splitters, viewport controls, icons and theme.
- `packages/shared`: asset factories, history, registries, fields and shell signals.
- The Gym, Desert and Backrooms GLBs from the cutoff. Draco is an ordinary public model decoder from Three.js, not a light baker.

## Rewritten

- Replaced `CornellBoxExample`/local BakeController orchestration with `src/studio.ts` and the existing high-level `src/provider.ts` API adapter.
- Added a canonical versioned contract, helper-free snapshots, JSON project persistence, GLB metadata export/import, stable IDs and runtime helper reconstruction.
- Replaced direct inspector writes with undoable transactions; all material slots can be edited. The outliner and mesh lists derive from the scene graph.
- Replaced legacy frame/atlas progress with actual API job states, platform errors and artifact links.
- Replaced duplicated quality selectors with preset buttons writing the exact global bake settings.

## Control audit and fixes

| Surface                 | Legacy issue                                                                 | Resolution                                                                           |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Selection               | Minimal app invalidated baking on selection                                  | Selection changes only transient selection/UI state                                  |
| Default light transform | Legacy special case skipped stale marking                                    | Every authored lighting transform participates in content identity                   |
| Inspector edits         | Name, visibility, materials/settings bypassed history                        | Transactional undo/redo with no-op suppression                                       |
| Material color          | Shared helper applied sRGB conversion twice                                  | Three Color.set performs the single conversion                                       |
| Shared preset materials | Editing one object changed siblings                                          | Isolated material instances per authored mesh                                        |
| Multi-material meshes   | Inspector silently omitted them                                              | Explicit material-slot picker                                                        |
| Rotation numbers        | Unlabeled radians                                                            | Degrees in UI, radians/quaternions in serialized scene                               |
| Light scaling           | Scale did not change Three area-light dimensions                             | Mesh-only scale authoring; light dimensions use width/height                         |
| Light direction         | Target-based Three lights could export with wrong direction                  | Snapshot orientation conversion to glTF local −Z                                     |
| Area orientation        | Existing worker's fixed X rotation conflicted with arbitrary rotations       | Explicit, tested marker compensation                                                 |
| Preset replacement      | Hoisted lights/cameras survived scene changes                                | Replace complete authored content; clear selection/history; dispose old resources    |
| Helpers                 | Circular userData, hidden mesh edits, helper export, camera double transform | Pruned serialization, helper reconstruction and camera-local helper matrices         |
| Emissive/glass geometry | `lightmapIgnore` conflated authoring, helpers and receiver exclusion         | Authored meshes stay selectable/exportable; receiver policy has explicit metadata    |
| Per-mesh overrides      | Competing `options.perMesh` and userData                                     | Only `lightbakerMesh`; backend gap visible in UI                                     |
| World settings          | Path-tracer state and HDR toggles could overwrite each other                 | One constant sky setting; unsupported HDR switch removed                             |
| Quality settings        | Unused casts, density and conflicting target/sample values                   | Canonical resolution/samples/bounces/denoise; preset values normalized to API limits |
| AgX                     | Menu secretly used ACES                                                      | Uses actual Three AgX tone mapping                                                   |
| SSAO intensity          | Actually changed occlusion reach                                             | Named `ssaoDistance` / “Occlusion reach”                                             |
| Post-FX                 | View fields not part of saved scene                                          | Included in versioned view metadata and undoable                                     |
| Bake completion         | Cleared stale even after intervening edits                                   | Compare submitted identity/generation; regression-tested delayed completion          |
| Undo disposal           | Multiple commands could own the same removed node                            | History reference counts and shared-resource protection                              |
| Viewport sizing         | Full-window sizing conflicted with shell panel layout                        | Canvas mounted in the actual resizable viewport                                      |
| Number fields           | Min/max were only HTML hints                                                 | Finite/range checks before writes; project metadata validation                       |
| Camera navigation       | FOV/speed ranges differed between surfaces                                   | Consistent authoring ranges; backend preview limitations documented                  |

## Removed or consolidated

- Local GI/bake integration, bake engine imports, probe computation UI, atlas internals and transport debug views. These belong to the private platform.
- Dummy lightmaps, phantom default-light state, path-tracer settings, dead dirty-mesh/log/compare state and unused inspector helper mutations.
- Reference split-screen, alternate ESL cached-lightmap mode, particle/audio presentation extras, LUT filename state, box-projected environment shader patch and disconnected HDR enable toggle. They were outside the portable authoring contract or had no functioning public bake path.
- Continuous camera-to-viewport writeback was replaced by explicit undoable **Capture viewport**. View-through and free navigation remain.
- The blank gradient gallery landing was consolidated into the in-editor scene picker.
- The minimal `src/editor.ts` and its old UI styles were replaced by the migrated architecture. No proprietary baking implementation was copied.

## Migrated presets

`cornell.classic`, `cornell.advanced`, `cornell.glass-mirror`, `cornell.emissive-strip`, `threejs.pointlights`, `threejs.shadowmap`, `threejs.decals`, `isometric.room`, `showcase.probe-architectural`, `esl.gym`, `esl.desert`, `esl.backrooms`.

ESL presets retain their original authored GLB geometry, camera placement and PBR adjustments. Reference baked lighting is removed, and they do not claim the old presentation effects or HDR lighting are reproduced. The architectural showcase is an authorable public scene; it does not pretend to execute a local probe solver.

## Verification

- Type checking, production bundle and a public/private boundary test.
- Unit tests for helper exclusion, material/emissive and mesh metadata roundtrips, target directions, area marker orientation, color correctness, content identity, history failures and shared-resource disposal.
- Browser tests for inspector history, add/delete, project reopening, all twelve presets, exported GLB metadata, delayed-job stale tracking and undo back to baked content.
- Opt-in live platform test: Cornell, 128px, 4 samples, 0 bounces, denoise off. A real preview and lightmap were returned using the unmodified private platform.

Backend gaps and exact field semantics are documented in [STUDIO-CONTRACT.md](STUDIO-CONTRACT.md). Desktop mouse/keyboard authoring remains the supported interaction model.
