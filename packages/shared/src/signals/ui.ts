import { signal } from "@preact/signals";

export type SceneNodeKind = "mesh" | "light" | "camera";
export type SceneNode = {
  id: string;
  name: string;
  kind: SceneNodeKind;
  visible: boolean;
};

export const selectedId = signal<string | null>(null);

export const sceneTree = signal<SceneNode[]>([]);

export const gizmoMode = signal<"translate" | "rotate" | "scale">("translate");

export const objectTick = signal<number>(0);

export const activeSceneId = signal<string>("cornell.advanced");

export const layout = signal<{ outlinerW: number; inspectorW: number }>({
  outlinerW: 280,
  inspectorW: 320,
});

export const inspectorTab = signal<string>("object");

export type ViewLayerDescriptor = {
  id: string;
  label: string;
  group: "output" | "debug";
};

export const viewLayers = signal<ReadonlyArray<ViewLayerDescriptor>>([]);

export const flySpeed = signal<number>(5);
export const flyActive = signal<boolean>(false);
export const cameraFOV = signal<number>(50);

export const activeCameraId = signal<string | null>(null);

export const showGrid = signal<boolean>(true);
export const showAxes = signal<boolean>(true);

export type PostFXSettings = {
  master: boolean;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;

  bloom2Enabled: boolean;
  bloom2Strength: number;
  bloom2Radius: number;
  bloom2Threshold: number;
  ssaoEnabled: boolean;
  ssaoDistance: number;
  ssaoRadius: number;
  toneMapping: "none" | "linear" | "reinhard" | "cineon" | "aces" | "agx";
  exposure: number;
  vignetteEnabled: boolean;
  vignetteStrength: number;

  fogEnabled: boolean;
  fogColor: number; // 0xRRGGBB
  fogDensity: number;

  hueSatEnabled: boolean;
  hue: number; // -1..1 (radians / PI)
  saturation: number; // -1..1

  gamma: number;

  lensDistortionEnabled: boolean;
  baseIor: number;
  bandOffset: number;
  jitterIntensity: number;
};

export const defaultPostFX = (): PostFXSettings => ({
  master: false,
  bloomEnabled: true,
  bloomStrength: 0.35,
  bloomRadius: 0.4,
  bloomThreshold: 0.85,
  bloom2Enabled: false,
  bloom2Strength: 0.25,
  bloom2Radius: 0.85,
  bloom2Threshold: 0.3,
  ssaoEnabled: true,
  ssaoDistance: 0.125,
  ssaoRadius: 0.2,
  toneMapping: "aces",
  exposure: 1.0,
  vignetteEnabled: false,
  vignetteStrength: 0.4,
  fogEnabled: false,
  fogColor: 0x707656,
  fogDensity: 0.0012,
  hueSatEnabled: false,
  hue: 0,
  saturation: 0,
  gamma: 1,
  lensDistortionEnabled: false,
  baseIor: 0.935,
  bandOffset: 0.0013,
  jitterIntensity: 5,
});
export const postFXSettings = signal<PostFXSettings>(defaultPostFX());
