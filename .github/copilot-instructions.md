# Repository scope

This is the public LightBaker product interface and API client.

Do not implement or copy the baking engine, renderer backend, WebGPU/WebGL shaders, BVH traversal, GI transport, denoising internals, GPU workers, or private agent/diagnostic logic here.

All baking must stay behind the high-level `BakeProvider` boundary in `src/provider.ts`.

The public legacy/reference implementation is `Ibrahim-3d/three-lightmap-baker`. The hosted backend is private and should be treated as an external service from this repository.
