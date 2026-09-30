import { LightBakerClient, type SceneInput, type SceneMetadata, type LightMetadata } from '@lightbaker/sdk';

const client = new LightBakerClient({ endpoint: 'https://example.com' });
const input: SceneInput = { file: new File([], 'scene.glb') };
void client.bakeScene(input, { quality: 'production' });
const metadata: SceneMetadata = { version: 2, world: { color: '#17191d', intensity: 0.15 },
  bake: { resolution: 256, samples: 16, bounces: 2, denoise: true } };
const area: LightMetadata = { type: 'area', color: '#fff', intensity: 5, width: 1, height: 1 };
void metadata; void area;
// @ts-expect-error Scene graphs are not the remote package contract.
void client.bakeScene({ children: [] });
// @ts-expect-error Presets must be recognized product values.
void client.bakeScene(input, { quality: 'ultra' });
// @ts-expect-error No GPU options exist on the public interface.
void client.bakeScene(input, { maxGPUBytes: 10 });
// @ts-expect-error Scene metadata versions are explicitly supported.
const unknownVersion: SceneMetadata = { ...metadata, version: 3 };
void unknownVersion;
// @ts-expect-error Area lights need authored dimensions.
const incompleteArea: LightMetadata = { type: 'area', color: '#fff', intensity: 1 };
void incompleteArea;
