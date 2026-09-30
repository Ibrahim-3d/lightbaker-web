# Artifact model

`BakeArtifact` is a transport descriptor: `kind`, `name`, absolute HTTP(S) `url`, and optional service-supplied `mediaType`. Relative URLs are resolved against the client's endpoint. Known kinds are `preview`, `lightmap`, and `scene`; unknown future kinds are retained so clients can ignore or separately consume them. Names are display/download hints, not filesystem paths the SDK writes automatically.

The current service returns an array like:

```json
[
  { "kind": "preview", "name": "baked-preview.png", "url": "http://127.0.0.1:8787/artifacts/JOB_ID/preview.png" },
  { "kind": "lightmap", "name": "lightmap.png", "url": "http://127.0.0.1:8787/artifacts/JOB_ID/lightmap.png" }
]
```

Pending/failed jobs may return an empty array. `wait` only requests artifacts after successful completion and rejects if that successful job has none. Call `getArtifacts` again to obtain updated URLs if a future service expires links; retention/expiration are not specified by the existing prototype.

`downloadArtifact` returns a browser/Node `Blob` with the download response's media type. It follows normal fetch behavior and sends no credentials. Artifact hosts must allow browser CORS when downloading bytes; an ordinary URL displayed in an image may have different browser rules. Cross-origin descriptors are allowed for storage/CDN use. URLs must be HTTP(S) without embedded credentials. The SDK never appends API credentials to artifact URLs.

The current PNG lightmap/preview must not be assumed to be an HDR linear irradiance interchange representation. Descriptors do not specify exposure, transfer function, vertical orientation, atlas dimensions, precision or mesh/UV association. This SDK does not guess those semantics or mount textures into Three materials.

For M4 full WebGPU results, the backend needs a public artifact contract for **every atlas**, linear-lightmap encoding/dimensions/orientation, and a scene/geometry association manifest with stable source IDs, complete remapped attributes/indices and instance identities. Returning only new UVs against original indices is insufficient. Preview images are a separate display product. No existing PNG descriptor is silently promoted to this richer contract; those backend changes and the Studio application step belong to M4.
