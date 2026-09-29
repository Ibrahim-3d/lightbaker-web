import { getOrchestratorAs, menuRegistry } from "shared";
import type { Studio } from "../../../../src/studio";
const app = () => getOrchestratorAs<Studio>();
menuRegistry.register("File", {
  id: "file.save",
  label: "Save Studio project",
  action: () => app()?.saveProject(),
});
menuRegistry.register("File", {
  id: "file.open",
  label: "Open Studio project…",
  action: () => app()?.openProjectFile(),
});
menuRegistry.register("File", {
  id: "file.import",
  label: "Import GLB…",
  action: () => app()?.importGLB(),
});
menuRegistry.register("File", {
  id: "file.export",
  label: "Export scene GLB",
  action: () => {
    void app()?.exportSceneGLB();
  },
});
