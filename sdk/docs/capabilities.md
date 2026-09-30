# Versions and capabilities

The existing service has no version/capability discovery endpoint. With only `{ endpoint }`, the client uses its locally defined product wire contract `1`: the existing unversioned `bakeScene`, `getJob`, and `getArtifacts` routes. No version is claimed to have been confirmed by the server.

`getCapabilities()` reports:

```ts
{
  apiVersion: '1', source: 'legacy', formats: ['glb'],
  sceneContractVersions: null, features: null,
  maxSceneBytes: 25 * 1024 * 1024, cancellation: false,
}
```

`null` means **unknown**, not full feature support. The SDK understands scene metadata versions 1/2, but the legacy API does not advertise which settings its worker actually interprets. No discovery request or unsupported cancellation POST is attempted in this mode.

## Optional discovery extension

This is a public SDK reference contract for a future compatible service, exercised by the mock. It is **not an endpoint added to or already supported by the private platform**. The URL must be explicitly configured and use the API origin:

```ts
const client = new LightBakerClient({ endpoint, capabilitiesUrl: 'capabilities' });
const capabilities = await client.getCapabilities();
```

The configured URL must return JSON matching `CapabilityDocument`:

```json
{
  "apiVersions": ["1"],
  "sceneContractVersions": [1, 2],
  "formats": ["glb"],
  "cancellation": false,
  "maxSceneBytes": 26214400,
  "features": ["diffuse-lightmaps"]
}
```

The SDK selects product contract `1` if advertised, intersects scene versions with `[1,2]`, requires GLB, and rejects when there is no common API/format/scene version. API `1` means the exact existing route/response shapes; it requires no additional version header or query parameter. A multi-version service advertising `1` must still accept those shapes at the configured endpoint. Unknown feature names are retained. `features` are outcome/authoring claims, never renderer primitives. Missing features are unknown. Byte limit/features are optional; absent byte limit uses the conservative legacy maximum.

Successful discovery is cached per client as an immutable capability value with `source: 'negotiated'`. Concurrent first calls may independently discover; callers' abort signals remain independent. Create a new client after a service/contract change. Explicit discovery errors (including 404, malformed JSON, incompatible versions, network errors) never fall back silently. Required feature policies can be enforced by the application before submission.

If a service advertises `cancellation: true` for API `1`, it must implement the optional extension `POST /cancelJob/:id` returning a normal `BakeJob`. Cancelling a completed job may return its completed state; cancellation may be pending. The terminal cancelled status is `cancelled`. The current platform lacks this extension, so the default remains false. The mock's cancellation tests validate only this conditional wire contract; they are not evidence of a remotely cancellable GPU worker.
