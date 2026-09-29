# LightBaker Web

Public product interface and API client for LightBaker.

This repository contains the website/demo layer only. It does **not** contain the light-baking engine, GPU shaders, BVH/GI implementation, workers, or proprietary backend code.

## Repository map

- [three-lightmap-baker](https://github.com/Ibrahim-3d/three-lightmap-baker) — original MIT-licensed browser-local WebGL implementation and reference package.
- **lightbaker-web** — this repository; public product UI, demo, viewer and API client.
- **Hosted LightBaker backend** — private implementation that performs remote baking. Its engine source is intentionally not distributed from this repository.

## Current status

The public client contract is established:

```text
POST /bakeScene
GET  /getJob/:id
GET  /getArtifacts/:id
```

Set `VITE_LIGHTBAKER_API_URL` to a compatible hosted API origin.

Without an API URL, the interface runs in clearly labeled **sample mode**. Sample mode never uploads or bakes the selected file; it displays an existing public baked reference.

The `BakeProvider` abstraction in `src/provider.ts` is the only baking boundary:

```ts
interface BakeProvider {
  bakeScene(scene: SceneInput, options?: BakeOptions): Promise<BakeJob>;
  getJob(id: string): Promise<BakeJob>;
  getArtifacts(id: string): Promise<BakeArtifact[]>;
}
```

Keep the API high-level. Renderer, shader, worker, BVH, denoising and transport internals do not belong in this repository.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run dev
```

## Architecture rule

```text
lightbaker-web
      |
      | public high-level API
      v
hosted LightBaker backend
      |
      v
private GPU baking implementation
```

The public UI should be able to evolve independently of the renderer implementation.

## License

The public web/client code is MIT-licensed. The hosted LightBaker backend is separate and is not licensed by this repository.
