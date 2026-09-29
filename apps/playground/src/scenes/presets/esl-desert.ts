import {
  Color,
  DoubleSide,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
} from "three";
import { sceneRegistry, type SceneBuildResult } from "shared";
import {
  addSunLight,
  addSpawnCamera,
  clearReferenceLighting,
  ESL_BASE,
  eulerToTarget,
  loadEslGLB,
  normalisePBRMaterials,
} from "./esl-shared";

const SPAWN_POS = [
  -20.248270295839482, 30.474685713014907, 228.6331292366264,
] as const;
const SPAWN_EULER = [-0.20013325422857836, -0.6010142617371497, 0] as const;

async function build(parent: Object3D): Promise<SceneBuildResult> {
  const root = new Object3D();
  root.name = "esl-desert-root";
  parent.add(root);

  const gltf = await loadEslGLB(`${ESL_BASE}/desert.optimized.glb`);
  root.add(gltf.scene);

  gltf.scene.traverse((obj) => {
    const m = obj as Mesh;
    if (!m.isMesh) return;
    const mat = m.material as MeshStandardMaterial;
    if (!mat || Array.isArray(mat)) return;
    // Demo nukes the AO map across the scene.
    mat.aoMap = null;
    if (m.name === "water") {
      mat.roughness = 0;
      mat.metalness = 1;
      mat.transparent = true;
      mat.opacity = 0.15;
      mat.side = DoubleSide;
      if (mat.color) mat.color.multiplyScalar(2);
    }
    mat.needsUpdate = true;
  });

  normalisePBRMaterials(gltf.scene);
  clearReferenceLighting(gltf.scene);

  addSpawnCamera(root, SPAWN_POS, SPAWN_EULER, 52);

  // Strong outdoor sun, high above, slight tilt.
  addSunLight(root, [0.3, -0.9, 0.3], 2.5, 200);

  const cam = eulerToTarget(
    [SPAWN_POS[0], SPAWN_POS[1], SPAWN_POS[2]],
    [SPAWN_EULER[0], SPAWN_EULER[1], SPAWN_EULER[2]],
    30,
    52,
  );

  return {
    camera: cam,
    background: new Color(0x74aa48).getHex(),
    skyIntensity: 0.6,
    disableFallbackLight: true,
  };
}

sceneRegistry.register({
  id: "esl.desert",
  label: "ESL - Desert",
  category: "esl",
  description:
    "Port of enhance-shader-lighting Desert demo. Outdoor terrain + water. AO map dropped per source demo. Post-FX parity via task #4.",
  source: {
    name: "0beqz / enhance-shader-lighting",
    url: "https://github.com/0beqz/enhance-shader-lighting",
    license: "MIT",
    author: "0beqz",
  },
  referenceUrl: "https://enhance-shader-lighting.vercel.app/?scene=desert",
  build,
  defaultBakeSettings: {
    resolution: 1024,
    samples: 128,
    bounces: 1,
  },
  schemaVersion: 1,
});
