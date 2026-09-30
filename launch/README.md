# LightBaker launch capture

This folder produces the truthful visual assets for the LightBaker launch film.

## What it proves

The three source scenes are authored entirely in Three.js code and rendered with ordinary WebGL raster lighting/shadow maps. The capture script exports the same authored scene to GLB, submits it to the real LightBaker API, and saves the returned baked preview and lightmap.

This avoids a fake "clay scene" comparison and avoids claiming prompt-driven artistic relighting that the product does not currently provide.

## Scenes

- **hero** — furnished interior; primary launch shot.
- **game** — stylized outdoor game environment.
- **lab** — dense technical/workshop environment.

Each scene includes an area-light marker because the current private worker requires at least one area light.

## Run

Start the private platform locally first:

```bash
# in lightbaker-platform
pnpm run build:cloud
pnpm run cloud:serve
```

Then, in this repository:

```bash
pnpm install
pnpm exec playwright install chromium
node launch/capture.mjs
```

Optional API override:

```bash
LIGHTBAKER_API_URL=http://127.0.0.1:8787 node launch/capture.mjs
```

Windows PowerShell:

```powershell
$env:LIGHTBAKER_API_URL="http://127.0.0.1:8787"
node launch/capture.mjs
```

## Output

Generated files are written to `launch/output/`:

- `hero-before.png`, `hero-after.png`, `hero-lightmap.png`, `hero.glb`
- equivalent files for `game` and `lab`
- `contact-sheet.png`

The **before** frame is the ordinary Three.js render. The **after** frame is the actual preview artifact returned by LightBaker. The edit should use locked-camera comparisons and must not replace the after frames with AI-generated imagery.

## Launch claim

Recommended core statement:

> AI can build the scene. LightBaker gives it a light-baking pipeline.

Technical phrasing:

> A programmable light-baking pipeline that software and AI agents can call.

Do not claim autonomous artistic relighting, final-frame rendering, public cloud availability, or arbitrary live Three.js-to-bake execution beyond the current GLB API boundary.
