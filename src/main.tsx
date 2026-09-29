import { render } from "preact";
import { App } from "../packages/demo-shell/src/App";
import "../packages/demo-shell/src/theme.css";
import "../apps/playground/src/scenes/presets";
import {
  BakePage,
  LightPage,
  WorldPage,
} from "../packages/demo-shell/src/inspector/StudioPages";
import { PostFXPage } from "../packages/demo-shell/src/inspector/PostFXPage";
import { Studio } from "./studio";
import {
  commandHistory,
  flyActive,
  gizmoMode,
  panelRegistry,
  selectedId,
  setOrchestrator,
  showGrid,
  viewLayers,
  sceneTree,
  type AssetSpec,
} from "shared";

const studio = new Studio();
setOrchestrator(studio);
panelRegistry.register({ id: "light", label: "Light", component: LightPage });
panelRegistry.register({ id: "world", label: "World", component: WorldPage });
panelRegistry.register({ id: "bake", label: "Bake", component: BakePage });
panelRegistry.register({ id: "postfx", label: "View", component: PostFXPage });
viewLayers.value = [
  { id: "lit", label: "Material preview", group: "output" },
  { id: "wireframe", label: "Wireframe", group: "debug" },
  { id: "normals", label: "Normals", group: "debug" },
];
render(<App />, document.getElementById("app")!);
void studio.loadScenePreset(
  new URLSearchParams(location.search).get("scene") || "cornell.classic",
);

const canvas = studio.sceneController.renderer.domElement;
document.getElementById("studio-viewport")!.appendChild(canvas);
canvas.style.cssText = "position:absolute;inset:0;pointer-events:auto;";
const viewportObserver = new ResizeObserver(() =>
  studio.sceneController.updateSize(),
);
viewportObserver.observe(canvas.parentElement!);
studio.sceneController.updateSize();
const dragover = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes("application/x-baker-asset"))
    e.preventDefault();
};
const drop = (e: DragEvent) => {
  const payload = e.dataTransfer?.getData("application/x-baker-asset");
  if (!payload) return;
  e.preventDefault();
  try {
    studio.addAsset(
      JSON.parse(payload) as AssetSpec,
      studio.sceneController.pickGroundPoint(e.clientX, e.clientY),
    );
  } catch (cause) {
    studio.report(cause);
  }
};
canvas.addEventListener("dragover", dragover);
canvas.addEventListener("drop", drop);
const keydown = (e: KeyboardEvent) => {
  if (
    (e.target as HTMLElement)?.closest(
      'input,textarea,select,[contenteditable="true"]',
    )
  )
    return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "y")) {
    e.preventDefault();
    if (k === "y" || e.shiftKey) commandHistory.redo();
    else commandHistory.undo();
    return;
  }
  if (flyActive.value) return;
  if (k === "w") gizmoMode.value = "translate";
  else if (k === "e") gizmoMode.value = "rotate";
  else if (k === "r") gizmoMode.value = "scale";
  else if (k === "delete" || k === "backspace") {
    e.preventDefault();
    studio.deleteSelected();
  } else if (k === "escape") selectedId.value = null;
  else if (k === "b") void studio.requestBake();
  else if (k === "f" && selectedId.value) studio.frameNode(selectedId.value);
  else if (k === "g") showGrid.value = !showGrid.value;
  else if (k === "1")
    studio.sceneController.setView(e.shiftKey ? "back" : "front");
  else if (k === "3")
    studio.sceneController.setView(e.shiftKey ? "left" : "right");
  else if (k === "7")
    studio.sceneController.setView(e.shiftKey ? "bottom" : "top");
  else if (k === "0") studio.sceneController.setView("persp");
  else if (k === "arrowup" || k === "arrowdown") {
    e.preventDefault();
    const ids = sceneTree.value.map((n) => n.id);
    const i = ids.indexOf(selectedId.value ?? "");
    selectedId.value =
      ids[(i + (k === "arrowup" ? -1 : 1) + ids.length) % ids.length] ?? null;
  }
};
window.addEventListener("keydown", keydown);
if (import.meta.env.DEV && new URLSearchParams(location.search).has("test"))
  Object.assign(window, { __studio: studio });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    viewportObserver.disconnect();
    window.removeEventListener("keydown", keydown);
    canvas.removeEventListener("dragover", dragover);
    canvas.removeEventListener("drop", drop);
    studio.dispose();
    render(null, document.getElementById("app")!);
  });
