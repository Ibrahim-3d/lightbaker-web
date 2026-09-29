# LightBaker Studio

Public Three.js scene and light authoring Studio, rehabilitated from the legacy editor at `e73efec8e179689d952c99c2f964aca8ed35b7b5`.

The public application includes an outliner, selection, transform gizmos, undo/redo, Asset Library, six primitives, Point/Spot/Directional/Area lights, cameras, object/material/emissive inspectors, world and bake controls, fly/orbit navigation, post-processing, twelve demo scenes, JSON projects and GLB import/export.

Baking happens exclusively through the high-level private platform API:

```text
POST /bakeScene
GET  /getJob/:id
GET  /getArtifacts/:id
```

There is no local GI implementation, bake shader, BVH/path tracer, compute pipeline or worker in this repository. The three public post-processing shaders only affect the editor view.

## Run

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Set `VITE_LIGHTBAKER_API_URL` to the platform origin (development defaults to `http://127.0.0.1:8787`). Configure the separately running platform's allowed web origin to match this app. Authoring works without a server; Bake reports actual API errors rather than simulated results. In production, Bake is disabled until an API URL is configured.

Public deployment is intentionally on hold until a hosted LightBaker API is available. The Studio never substitutes a canned/reference result for a submitted bake: authoring works without the backend, but real baking requires `VITE_LIGHTBAKER_API_URL`.

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

Per-mesh overrides, hidden-node transport filtering, complete view metadata, HDR assets and probe execution still need backend support. Punctual-only and emissive-only scenes currently fail the worker's area-light requirement; Studio preserves the scene rather than altering its lighting.

MIT licensed. The private LightBaker platform is separate and is not licensed by this repository.
