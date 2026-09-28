# LightBaker Web

Public LightBaker product interface, adapted from the gallery and visual language of the original `three-lightmap-baker` playground. It keeps the original before/preview/production showcase and provides a standalone bake request and result UI.

The `BakeProvider` in `src/provider.ts` is the only bridge to baking. Set `VITE_LIGHTBAKER_API_URL` to a hosted API origin implementing `POST /bakeScene`, `GET /getJob/:id`, and `GET /getArtifacts/:id`. The request sends a GLB as `model/gltf-binary` with a high-level `quality` parameter. The API returns high-level job and artifact objects; no renderer, shader, or worker implementation belongs here.

Without an API URL, the interface runs in explicitly labeled **sample mode**. It displays an existing baked screenshot and never uploads or bakes the selected file. Reference images are served from the immutable public cutoff of the legacy repository.

```sh
npm install
npm run build
npm run dev
```

The old `pt-preview` and `pt-baked` apps directly invoked renderer and path tracing internals. Their engine code is retained in the private platform; the public before/after demonstration lives here. The complete original demo remains in the legacy repository history under the MIT license.
