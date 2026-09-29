import {
  Color,
  Mesh,
  type MeshStandardMaterial,
  Object3D,
  Vector2,
} from "three";
import { sceneRegistry, type SceneBuildResult } from "shared";
import {
  clearReferenceLighting,
  addSpawnCamera,
  ESL_BASE,
  eulerToTarget,
  loadEslGLB,
  normalisePBRMaterials,
} from "./esl-shared";

const SPAWN_POS = [1.16, 1.35, -1.647] as const;
const SPAWN_EULER = [0.002, -1.578, 0] as const;

type WallTweak = {
  name: string;
  roughness: number;
  metalness: number;
  normalScale: number;
};

const TWEAKS: WallTweak[] = [
  { name: "MG_Walls003", roughness: 0.12, metalness: 0, normalScale: 1.49 },
  {
    name: "MG_Walls003_1",
    roughness: 0.79,
    metalness: 0.18,
    normalScale: 2.56,
  },
  {
    name: "MG_Walls003_2",
    roughness: 1.06,
    metalness: 0.13,
    normalScale: 3.48,
  },
];

async function build(parent: Object3D): Promise<SceneBuildResult> {
  const root = new Object3D();
  root.name = "esl-backrooms-root";
  parent.add(root);

  const gltf = await loadEslGLB(`${ESL_BASE}/backrooms.optimized.glb`);
  root.add(gltf.scene);

  for (const t of TWEAKS) {
    const obj = gltf.scene.getObjectByName(t.name) as Mesh | undefined;
    if (!obj?.isMesh) continue;
    const mat = obj.material as MeshStandardMaterial;
    if (!mat || Array.isArray(mat)) continue;
    mat.roughness = t.roughness;
    mat.metalness = t.metalness;
    mat.color = new Color(0xffffff);
    if (mat.normalScale)
      mat.normalScale.copy(new Vector2(t.normalScale, t.normalScale));
    mat.needsUpdate = true;
  }

  normalisePBRMaterials(gltf.scene);
  clearReferenceLighting(gltf.scene);
  // No sun: backrooms is windowless. Ceiling-fluorescent vibe deferred to a
  // proper emissive ceiling pass; for now bake leans on skyIntensity fill.

  addSpawnCamera(root, SPAWN_POS, SPAWN_EULER, 83);

  const cam = eulerToTarget(
    [SPAWN_POS[0], SPAWN_POS[1], SPAWN_POS[2]],
    [SPAWN_EULER[0], SPAWN_EULER[1], SPAWN_EULER[2]],
    3,
    83,
  );

  return {
    camera: cam,
    background: 0x111111,
    skyIntensity: 0,
    disableFallbackLight: true,
  };
}

sceneRegistry.register({
  id: "esl.backrooms",
  label: "ESL - Backrooms",
  category: "esl",
  description:
    "Port of enhance-shader-lighting Backrooms demo. Indoor maze. Audio + compression-pass deferred to PostFX task #4.",
  source: {
    name: "0beqz / enhance-shader-lighting",
    url: "https://github.com/0beqz/enhance-shader-lighting",
    license: "MIT",
    author: "0beqz",
  },
  referenceUrl: "https://enhance-shader-lighting.vercel.app/?scene=backrooms",
  build,
  defaultBakeSettings: {
    resolution: 1024,
    samples: 128,
    bounces: 3,
  },
  schemaVersion: 1,
});
