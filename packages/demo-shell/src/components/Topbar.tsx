import "../menus/index";
import {
  canUndo,
  canRedo,
  commandHistory,
  getOrchestratorAs,
  gizmoMode,
  selectedId,
  type MenuId,
} from "shared";
import { MenuButton } from "./MenuButton";
import { ScenePicker } from "./ScenePicker";
import { loading, type Studio } from "../../../../src/studio";
export function Topbar() {
  return (
    <header class="relative z-50 h-10 bg-bg-1 border-b border-border flex items-center px-3 gap-3 pointer-events-auto">
      <strong class="text-text-0 whitespace-nowrap">LIGHTBAKER STUDIO</strong>
      <nav class="flex">
        {(["File", "Edit", "View", "Help"] as MenuId[]).map((m) => (
          <MenuButton key={m} menuId={m} />
        ))}
      </nav>
      <button disabled={!canUndo.value} onClick={() => commandHistory.undo()}>
        Undo
      </button>
      <button disabled={!canRedo.value} onClick={() => commandHistory.redo()}>
        Redo
      </button>
      {(["translate", "rotate", "scale"] as const).map((mode) => (
        <button
          disabled={
            mode === "scale" &&
            !!(
              getOrchestratorAs<Studio>()?.lookupObject(selectedId.value)
                ?.userData.bakerLightType ||
              getOrchestratorAs<Studio>()?.lookupObject(selectedId.value)
                ?.userData.bakerCameraType
            )
          }
          title={
            mode === "scale"
              ? "Scale meshes; use width/height for area lights"
              : mode
          }
          class={gizmoMode.value === mode ? "text-accent" : ""}
          onClick={() => {
            gizmoMode.value = mode;
          }}
        >
          {mode}
        </button>
      ))}
      <button onClick={() => getOrchestratorAs<Studio>()?.deleteSelected()}>
        Delete
      </button>
      <div class="flex-1" />
      {loading.value ? <span>Loading scene…</span> : <ScenePicker />}
    </header>
  );
}
