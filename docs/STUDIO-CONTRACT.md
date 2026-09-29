# Studio scene contract v2

`src/contract.ts` defines the public authoring contract. The Three.js authored graph owns geometry, transforms, materials, lights and cameras. `settings` owns world/bake values. View signals own navigation and post-processing values. The outliner is a derived projection; there is no separate per-mesh options map or path-tracer settings object.

Projects use `{format: "lightbaker-studio", version: 2, preset, settings, view, scene}`. `scene` is Three ObjectLoader JSON with embedded geometry/material/texture data. Project loading validates metadata and awaits texture loading before replacing the scene. Runtime helpers, callbacks, viewport ambient illumination and gizmos are excluded. Camera/light helpers are rebuilt after loading.

## Bake transport

`POST /bakeScene?quality=preview` receives binary GLB. The query is a legacy fallback; explicit metadata settings always describe the requested quality. Preset buttons fill the same canonical values. `GET /getJob/:id` and `GET /getArtifacts/:id` are the only subsequent operations. No local bake, atlas packing, GPU transport, BVH, probe computation or worker code is shipped.

The GLB scene's `extras.lightbaker` contains:

```json
{
  "version": 2,
  "world": { "color": "#17191d", "intensity": 0.15 },
  "bake": { "resolution": 256, "samples": 16, "bounces": 2, "denoise": true },
  "view": {
    "position": [0, 5, 18],
    "target": [0, 5, 0],
    "fov": 50,
    "near": 0.1,
    "far": 1000,
    "mode": "lit",
    "grid": true,
    "axes": true,
    "flySpeed": 5,
    "postFX": {}
  }
}
```

For compatibility, `extras.lightbakerCamera` also contains the submitted viewport position, target and FOV. It is generated from `view`, never edited separately.

Node extras include `studioId` (stable authoring identity) and `lightbakerVisible`. Hidden authored nodes are retained so the payload represents the complete scene. The backend must evaluate ancestor visibility before transport, not just a node's own flag.

Mesh extras `lightbakerMesh` contain:

| Field        | Meaning                                                       |
| ------------ | ------------------------------------------------------------- |
| `receive`    | Allocate/bake a lightmap for this mesh; default true          |
| `contribute` | Participate in shadowing and indirect transport; default true |
| `density`    | Relative lightmap allocation multiplier, 0.25–4; default 1    |

Materials use standard glTF PBR fields and applicable material extensions, including emissive strength and physical transmission/IOR/thickness. Spot, Point and Directional lights use `KHR_lights_punctual`, plus `extras.lightbakerLight` for explicit color, intensity, distance, decay, spot half-angle/penumbra and type. Angles in metadata are radians. The serializer converts Three target-based direction to glTF local −Z on a snapshot, leaving the editor untouched.

Area lights use a marker node with `lightbakerLight: {type:"area", color, intensity, width, height}`. Width/height describe the emitter's physical dimensions. The existing worker reconstructs a child emitter rotated −90° around X; the exporter compensates the marker by +90° so arbitrary authored world orientation survives. Consumers must implement this convention exactly once. Studio's GLB importer reverses it.

## Current private worker support

Verified against local `lightbaker-platform` revision `fc781d0`, without modifying it. A live Cornell submission produced preview and lightmap artifacts.

| Feature                                         | Public authoring/export                                   | Current worker                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geometry and transforms                         | Full glTF graph                                           | Loaded by GLTFLoader                                                                                                                                                  |
| Standard PBR, emissive                          | Standard glTF materials/extensions                        | Loaded; full transport fidelity depends on the private baker                                                                                                          |
| Area lights                                     | Versioned markers; dimensions/color/intensity/orientation | Explicitly reconstructed; tested end-to-end                                                                                                                           |
| Point/Spot/Directional                          | glTF punctual extension + explicit extras                 | Standard loader reconstructs lights; worker still rejects any scene without an area marker. Nonphysical decay/custom range interpretation requires backend validation |
| World color/intensity                           | `world`                                                   | Interpreted as constant sky/background                                                                                                                                |
| Resolution/samples/bounces/denoise              | `bake`                                                    | Explicitly interpreted; UI stays within 128–1024, 4–128, 0–4                                                                                                          |
| Per-mesh controls                               | `lightbakerMesh`                                          | Not yet interpreted; UI identifies this limitation                                                                                                                    |
| Hidden objects                                  | `lightbakerVisible` and project visibility                | Worker must implement filtering; current GLTFLoader alone does not restore visibility extras                                                                          |
| Preview camera pose/FOV                         | Compatibility camera metadata plus full `view`            | Pose/FOV used; worker clamps FOV to 15–100 and uses its own clipping/aspect                                                                                           |
| Authored cameras, view modes, overlays, post-FX | glTF cameras + `view`                                     | Saved/exported; worker preview does not apply complete view metadata                                                                                                  |
| Transmission/refraction                         | Physical material extensions                              | Renderer loads values; transport parity is not promised                                                                                                               |
| Probe/architectural scene                       | Full public geometry/materials/lighting                   | Probe generation/interpolation/volumes are not exposed by this API                                                                                                    |
| HDR environment maps                            | Not exposed as an authoring control                       | Requires portable asset contract and worker support before reintroduction                                                                                             |

Emissive-only and punctual-only scenes remain authored as such: Studio does not silently insert an area light to make the worker accept them. Unsupported settings are preserved/documented, never reported as successfully interpreted.

## Invalidation and ownership

Bake starts from a synchronous snapshot before exporter awaits. Completion records the submitted content identity and scene generation. Later edits, scene replacement, or failed jobs cannot certify newer content. Undo can return to the same baked content. Selection, navigation, overlays and post-FX do not change lighting validity; the preview artifact remains the view captured at submission.

Inspector edits, material slots, mesh overrides, world/bake changes and view effects use commands. Gizmo drags are one command. Add/remove commands retain objects until every history owner releases them. Disposal protects resources referenced by live and retained objects, and includes line helpers, textures and shadow targets. Scene replacement clears history before disposing the old scene. There is no fake remote cancellation operation.
