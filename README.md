# LightBaker Studio

Read [workspace authority](../lumen-workspace/README.md) and [current handoff](docs/LUMEN-HANDOFF.md). The fast editable Three viewport remains an authoring aid. Completed prepared-package walkthrough links run actual Lumen; a continuously synchronized editable Lumen viewport is planned, not implemented.

Public Three.js scene and light authoring Studio, rehabilitated from the legacy editor at `e73efec8e179689d952c99c2f964aca8ed35b7b5`.

The public application includes an outliner, selection, transform gizmos, undo/redo, Asset Library, six primitives, Point/Spot/Directional/Area lights, cameras, object/material/emissive inspectors, world and bake controls, fly/orbit navigation, post-processing, twelve demo scenes, JSON projects and GLB import/export.

Baking stays outside this public repository. The remote **Bake on platform** action uses the high-level API:

```text
POST /bakeScene
GET  /getJob/:id
GET  /getArtifacts/:id
```

The optional host-neutral Lumen delivery adapter additionally supports the private local compile/bake/attach workflow; see [current Lumen handoff](docs/LUMEN-HANDOFF.md). It is separate from the remote API. There is no local GI implementation, bake shader, BVH/path tracer, compute pipeline or worker in this repository. The three public post-processing shaders only affect the editor view.

## Run

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Set `VITE_LIGHTBAKER_API_URL` to the platform origin (development defaults to `http://127.0.0.1:8787`). Configure the separately running platform's allowed web origin to match this app. Authoring works without a server; Bake reports actual API errors rather than simulated results. In production, Bake is disabled until an API URL is configured.

Public deployment is intentionally on hold until a hosted LightBaker API is available. The Studio never substitutes a canned/reference result for a submitted bake: authoring works without the backend, but the remote bake action requires `VITE_LIGHTBAKER_API_URL`. The private local delivery action instead requires its registered host adapter.

Double-click an asset or drag it into the viewport. W/E/R choose transform tools, F frames selection, Delete removes, Ctrl/Cmd+Z undoes. Hold RMB and use WASD/QE to fly. File → Save Studio project preserves the full authored scene; Export scene GLB creates the public transport artifact.

## Verify

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
```

Browser tests use installed Chrome on Windows and Playwright Chromium elsewhere. Set `CHROME_PATH` to override. The live platform test is opt-in with `LIVE_PLATFORM=1`; start the separate API with its allowed origin set to `http://127.0.0.1:5174`.

## Contracts and audit

- [Migration, copied architecture, control audit and preset inventory](docs/STUDIO-MIGRATION.md)
- [Versioned scene contract and current backend support](docs/STUDIO-CONTRACT.md)
- [Scene attribution](docs/SCENES-ATTRIBUTION.md)

For the retained remote classic worker, per-mesh overrides, hidden-node filtering, complete view metadata, HDR assets and probe execution have documented limits; punctual-only and emissive-only scenes encounter its area-light requirement. These are not blanket limitations of the distinct native WebGPU Lumen delivery path, which has emissive-delivery regression evidence. Studio preserves authored lighting rather than changing it to satisfy a worker.

MIT licensed. The private LightBaker platform is separate and is not licensed by this repository.
