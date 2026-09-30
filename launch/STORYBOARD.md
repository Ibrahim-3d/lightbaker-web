# LightBaker launch film — production storyboard

**Format:** 16:9 master, 50–55 seconds. Derive 30s and 15s cuts from the same edit.

**Product truth:** this film demonstrates an AI-style Three.js scene being exported as GLB, submitted to the current LightBaker API, and returning real baked preview/lightmap artifacts. No generated image may substitute for a LightBaker result.

## Narrative

> AI can build the scene. LightBaker gives it a light-baking pipeline.

The film starts at the visual level non-3D viewers understand, then progressively reveals the technical implementation.

| Time | Picture | On-screen language | Source |
| --- | --- | --- | --- |
| 0:00–0:04 | Hero interior, ordinary Three.js WebGL baseline. Slow 2–3% push-in. | **AI can already build 3D scenes.** | `hero-before.png` |
| 0:04–0:08 | Brief generic agent/code view beside the same scene. Show scene generation/export, not fictional artistic relighting. | **Three.js. WebGL. Real-time lights + shadows.** | Motion graphics + actual scene |
| 0:08–0:12 | Scene collapses visually into a GLB card/file; agent/tool call appears. | `bakeScene(scene.glb)` | Motion graphics |
| 0:12–0:17 | Minimal job state sequence: submitted → running → completed. Time-compressed. | **A lighting pipeline an agent can call.** | Real API nomenclature |
| 0:17–0:27 | Locked-camera hero reveal. Vertical wipe / A-B toggle between ordinary Three.js and actual baked preview. Hold long enough to inspect. | **Same scene. Same camera. Baked lighting.** | `hero-before.png` + `hero-after.png` |
| 0:27–0:33 | Raw generated lightmap fills screen, then maps back onto scene. | **Lighting calculated ahead of time.** | `hero-lightmap.png` |
| 0:33–0:41 | Fast proof montage: game environment and lab, each ordinary WebGL → actual LightBaker result. | **Not a renderer trick. The same 3D assets.** | `game-*`, `lab-*` |
| 0:41–0:47 | Clean pipeline diagram. | **Agent → GLB → LightBaker → Preview + Lightmap** | Motion graphics |
| 0:47–0:52 | Return to strongest baked hero frame. Minimal motion. | **AI can build the scene. LightBaker gives it a light-baking pipeline.** | `hero-after.png` |
| 0:52–0:55 | Black / near-black end card. | **LIGHTBAKER** · **Technical Preview** | Brand card |

## Language ladder

### General audience
**Lighting calculated ahead of time and stored with the 3D scene.**

### 3D audience
**Automated light baking for Three.js / GLB workflows.**

### Developer audience
**A programmable bake-job API and TypeScript SDK that returns preview and lightmap artifacts.**

Use the layers in that order. Do not lead with “global illumination”, “BVH”, “path tracing”, or backend implementation details.

## Claims allowed in this film

- LightBaker accepts a GLB through the current product API.
- A client/agent can submit the bake programmatically.
- Jobs can be tracked programmatically.
- Completed jobs return artifact metadata.
- The current worker returns a baked preview and PNG lightmap.
- The public SDK exposes high-level bake/job/artifact operations.
- The scene can originate from AI-authored Three.js code.

## Claims excluded

Do **not** say or visually imply:

- the AI autonomously designs the artistic lighting;
- arbitrary natural-language relighting is implemented;
- LightBaker is a final-frame renderer;
- arbitrary live Three.js memory is sent directly to the baker (the current boundary is GLB);
- WebGPU is the current remote/cloud bake backend;
- the hosted service is publicly available today;
- remote cancellation is currently supported;
- every Three.js material/shader is fully transported.

## Visual rules

1. The proof shots are never AI-generated video.
2. Before/after uses the exact captured frames without relighting or generative enhancement.
3. No clay-scene bait-and-switch. Baseline scenes keep their actual materials and normal WebGL lighting.
4. No fake ChatGPT UI. Use a neutral agent/terminal treatment unless an actual captured agent session is available.
5. Minimal typography; the scene remains the hero.
6. Color grade may normalize overall presentation, but never selectively improve the baked side.

## Higgsfield use

Spend credits only after the real capture set exists. Acceptable uses:

- 2–3 second abstract opening/closing transition;
- subtle camera/motion treatment on non-proof brand cards;
- optional transition from code/agent layer into the GLB pipeline.

Do not use Higgsfield for before/after scene results, lightmaps, or the claimed agent action.

## Deliverables

- 3840×2160 or 1920×1080 16:9 master, 50–55s.
- 1920×1080 30s product cut.
- 1080×1920 15s vertical cut with proof comparison centered in safe area.
- 6–8s silent website loop: hero baseline → wipe → baked result.
- 3 launch stills: hero comparison, pipeline diagram, end card.
