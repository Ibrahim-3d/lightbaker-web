# Repository scope

This is the public LightBaker product interface and API client.

Do not implement or copy the baking engine, renderer backend, WebGPU/WebGL shaders, BVH traversal, GI transport, denoising internals, GPU workers, or private agent/diagnostic logic here.

Remote baking stays behind `BakeProvider` in `src/provider.ts`; local Lumen delivery uses the public host-neutral adapter in `src/lumen-delivery.ts`. Neither boundary permits private implementation imports. Read `AGENTS.md`, `docs/LUMEN-HANDOFF.md` and `../lumen-workspace/README.md` for current ownership and acceptance.

The public legacy/reference implementation is `Ibrahim-3d/three-lightmap-baker`. The hosted backend is private and should be treated as an external service from this repository.
