# LightBaker Web

Public product interface and scene editor for the hosted LightBaker workflow.

This repository contains the public UI, demo, viewer, and API client only. It does **not** contain the light-baking engine, GPU shaders, BVH/GI implementation, workers, or proprietary backend code.

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

Set `VITE_LIGHTBAKER_API_URL` to a compatible hosted API origin. The local editor defaults to `http://127.0.0.1:8787`.

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
