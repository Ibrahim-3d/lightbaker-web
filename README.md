# LightBaker Web

Public product interface and scene editor for the hosted LightBaker workflow.

This repository contains the public UI, demo, viewer, and API client only. It does **not** contain the light-baking engine, GPU shaders, BVH/GI implementation, workers, or proprietary backend code.

## Live demo

GitHub Pages target: https://ibrahim-3d.github.io/lightbaker-web/

Until the hosted API is configured, the Pages deployment runs in **sample mode**: scenes stay local in the browser and the Bake action shows a known reference result rather than uploading or pretending to bake the edited scene.

## Features

- Three.js viewport, orbit controls, selection, and transform gizmos
- Scene outliner and object, material, area-light, world, and bake controls
- Cornell-style verification scene
- GLB export and remote job tracking
- Baked preview and lightmap results

The public bundle contains scene editing and glTF serialization only. `src/provider.ts` is the boundary to the private platform API. Editor-authored GLBs carry versioned LightBaker metadata in glTF `extras` for the platform to reconstruct.

## API contract

```text
POST /bakeScene
GET  /getJob/:id
GET  /getArtifacts/:id
```

Set `VITE_LIGHTBAKER_API_URL` to a compatible hosted API origin. If it is absent, the app runs in sample mode and performs no upload.

## Local development

Start `lightbaker-platform` first:

```sh
pnpm install --frozen-lockfile
pnpm run build:cloud
pnpm run cloud:serve
```

Then start this app:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run dev
```

Without an API URL, the interface runs in clearly labeled sample mode. The public UI can evolve independently of the renderer implementation.

## License

The public web/client code is MIT-licensed. The hosted LightBaker backend is separate and is not licensed by this repository.
