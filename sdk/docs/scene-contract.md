# Scene package and serialization

Transport is **raw glTF 2.0 GLB** with `Content-Type: model/gltf-binary`, never JSON wrapped bytes, multipart, a URL to an asset, a Three object, or the Studio project document. A GLB is the scene package: geometry, transforms, material slots, textures and authored metadata travel together. A separate ZIP/folder upload protocol does not exist in the current API.

Buffers/images must be embedded via GLB buffer views or data URIs. External filesystem/HTTP URIs are rejected by package inspection. The legacy upload limit is 25 × 1024 × 1024 bytes; negotiated services may supply their own positive byte limit.

The SDK validates GLB magic, container version/length, aligned chunk boundaries, first/unique JSON chunk, UTF-8/JSON, glTF asset version, default scene selection, external buffer/image references, and LightBaker scene metadata if present. It does **not** decode geometry/textures, validate every glTF extension, perform transforms, pack atlases or decide renderer fidelity. Unknown JSON/extras are preserved byte-for-byte. Renderer/loader validation remains the service's responsibility.

An unannotated GLB is permitted in legacy mode because the existing API accepts it; its scene contract version is reported as `null`. Optional negotiated services require a supported LightBaker metadata version. Missing or unknown metadata must never be described as full Studio parity.

## LightBaker scene extras

The selected glTF scene's `extras.lightbaker` contains version 1 or 2, world settings and bake settings:

```json
{
  "version": 2,
  "world": { "color": "#17191d", "intensity": 0.15 },
  "bake": { "resolution": 256, "samples": 16, "bounces": 2, "denoise": true },
  "view": {
    "position": [0, 5, 18], "target": [0, 5, 0], "fov": 50,
    "near": 0.1, "far": 1000, "mode": "lit", "grid": true,
    "axes": true, "flySpeed": 5, "postFX": {}
  }
}
```

World color is a six-digit hexadecimal sRGB color. World intensity is 0–4. Resolution is an integer 128–1024, samples an integer 4–128, bounces an integer 0–4, and denoise a boolean. Invalid supplied settings reject; no silent clamping occurs in the SDK. These are authored product controls, not private rendering parameters.

Version 2 retains view metadata for preview consumers. The current compatibility field `extras.lightbakerCamera` has `position`, `target`, `fov`, derived from the same view. View metadata does not change light transport. `SceneMetadata`, `WorldSettings`, `BakeSettings`, `ViewMetadata`, and `CameraMetadata` describe these public shapes.

## Node/material/light extras

`NodeMetadata`, `MeshMetadata`, and the discriminated `LightMetadata` union describe authoring data. The SDK preserves these bytes; the service interprets/validates them.

| Extra | Authoring meaning |
| --- | --- |
| `studioId` | Stable source identity for future result association |
| `lightbakerVisible` | Authored visibility; ancestor visibility also matters |
| `lightbakerMesh.receive` | Receive a lightmap; default true |
| `lightbakerMesh.contribute` | Contribute shadows/indirect/emission; default true |
| `lightbakerMesh.density` | Relative allocation multiplier; Studio range 0.25–4, default 1 |
| `lightbakerLight` | Explicit authored light metadata |

Use glTF geometry, indices, material groups, hierarchy transforms and standard PBR/emissive textures. Point/Spot/Directional lights use `KHR_lights_punctual` plus explicit type/color/intensity metadata. Point/Spot include `distance` and `decay`; Spot adds `angle` (radians, half-angle) and `penumbra`. glTF direction is local −Z; an exporter must convert target-based authored lights on a snapshot.

Area lights are marker nodes with `{ type: 'area', color, intensity, width, height }`. The existing contract reconstructs a child emitter rotated −90° around X; exporters compensate marker orientation by +90° exactly once. `lightbaker-web` already owns this authoring serialization convention. The SDK never reconstructs emitters or rotates nodes.

Snapshot authored content before async export. Retain hidden authored nodes; exclude helpers/gizmos/callbacks. Preserve full source IDs and transforms. Standard glTF exporters or the Studio serializer may create the package; no Three-specific serialization dependency belongs in the SDK. `examples/scene-package.mjs` constructs a small complete reference room GLB directly from authored data.

Supported engine fidelity is diffuse lightmapping. Physical transmission/specular paths and normal/bump/displacement effects are not guaranteed by this SDK. Skinned/morphed meshes, compression decoding and portable HDR assets require explicit service support/preparation; the current default loader does not configure Draco/KTX2. The SDK does not infer remote capabilities from a completed private engine milestone. Probe generation has no public operation in this contract.
