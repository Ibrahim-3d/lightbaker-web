import { Object3D } from "three";
import { sceneRegistry, type SceneBuildResult } from "shared";
import {
  addSunLight,
  addSpawnCamera,
  clearReferenceLighting,
  applyMeshTweaks,
  ESL_BASE,
  type EslMeshTweak,
  eulerToTarget,
  loadEslGLB,
  normalisePBRMaterials,
} from "./esl-shared";

const SPAWN_POS = [9.357940673828125, 3, -25] as const;
const SPAWN_EULER = [0, -Math.PI, 0] as const;

const TWEAKS: EslMeshTweak[] = [
  { name: "floor", roughness: 2.26, metalness: 0.23, normalScale: [1.5, 1.5] },
  { name: "props", roughness: 0.62, metalness: 0.16, normalScale: [1, 1] },
  { name: "props2_4", roughness: 0.67, metalness: 0.16, normalScale: [1, 1] },
  { name: "props2_5", roughness: 0.53, metalness: 0.04, normalScale: [1, 1] },
  { name: "props2_2", roughness: 0.48, metalness: 0.55, normalScale: [1, -1] },
  {
    name: "props2_3",
    roughness: 0.79,
    metalness: 0.13,
    normalScale: [0.39, 0.39],
  },
  // exteriors 1..6: same defaults; exterior_3 overrides normalScale below.
  ...[1, 2, 3, 4, 5, 6].map((i): EslMeshTweak => ({
    name: `exterior_${i}`,
    roughness: 0.84,
    metalness: 0.12,
    normalScale: [1, 1],
  })),
  { name: "exterior_3", normalScale: [0.48, 0.48] },
];

async function build(parent: Object3D): Promise<SceneBuildResult> {
  const root = new Object3D();
  root.name = "esl-gym-root";
  parent.add(root);

  const gltf = await loadEslGLB(`${ESL_BASE}/gym.optimized.glb`);
  root.add(gltf.scene);

  applyMeshTweaks(gltf.scene, TWEAKS);
  normalisePBRMaterials(gltf.scene);
  clearReferenceLighting(gltf.scene);
  // Parallax-correct envmap against the gym interior box. Numbers match the
  // ESL GymDemo.js source (envMapPos / envMapSize). Patch is silent until
  // user enables env intensity via WorldPage.

  addSpawnCamera(root, SPAWN_POS, SPAWN_EULER, 56);

  // ESL gym uses Kloofendal HDR with sun rotated to y=4.94 rad ≈ 283°.
  // sin(4.94) ≈ -0.97, cos(4.94) ≈ 0.23. Sun comes from the west, slightly
  // back-of-camera, pitched ~45° down. direction = where sun POINTS (toward
  // origin), so it's roughly (+0.97, -0.7, -0.23) normalised.
  addSunLight(root, [0.78, -0.56, -0.18], 2, 80);

  // ESL adds a dust-mote zone here (`addAmbientDustZone(0,-3,0, 40,70, 500)`).

  // Stash the ESL look-config so task #4's PostFX wiring can read it on
  // scene-switch without re-importing this file. Read by ScenePicker layer.

  const cam = eulerToTarget(
    [SPAWN_POS[0], SPAWN_POS[1], SPAWN_POS[2]],
    [SPAWN_EULER[0], SPAWN_EULER[1], SPAWN_EULER[2]],
    10,
    56,
  );

  return {
    camera: cam,
    background: 0x707656,
    // Probe loaded but environmentIntensity defaults to 0 + per-material
    // envMapIntensity=0 → no visual leak. User cranks WorldPage slider to
    // turn it on; box-projection is already wired so reflections will be
    // parallax-correct the moment the env contribution > 0.
    skyIntensity: 0,
    disableFallbackLight: true,
  };
}

sceneRegistry.register({
  id: "esl.gym",
  label: "ESL - Gym",
  category: "esl",
  description:
    "Port of enhance-shader-lighting Gym demo. ~5.5 MB GLB. Public geometry and standard PBR materials; lighting is authored in Studio.",
  source: {
    name: "0beqz / enhance-shader-lighting",
    url: "https://github.com/0beqz/enhance-shader-lighting",
    license: "MIT",
    author: "0beqz",
  },
  referenceUrl: "https://enhance-shader-lighting.vercel.app/?scene=gym",
  build,
  defaultBakeSettings: {
    resolution: 1024,
    samples: 128,
    bounces: 2,
  },
  schemaVersion: 1,
});
