import { menuRegistry } from "shared";

/**
 * Help menu (T-D9).
 */

menuRegistry.register("Help", {
  id: "help.hotkeys",
  label: "Keyboard Shortcuts",
  action: () => {
    alert(
      [
        "KEYBOARD SHORTCUTS",
        "",
        "Transform gizmo:",
        "  W   Translate    E   Rotate    R   Scale",
        "",
        "Bake / view:",
        "  B   Re-bake (when stale)",
        "  F   Frame selected",
        "  G   Toggle ground grid",
        "",
        "Camera (Blender numpad convention):",
        "  1 / Shift+1   Front / Back",
        "  3 / Shift+3   Right / Left",
        "  7 / Shift+7   Top / Bottom",
        "  0             Perspective",
        "",
        "Selection:",
        "  Arrow Up/Down Step through outliner",
        "  Esc           Deselect",
        "  Del / Bksp    Delete selected node",
        "",
        "History:",
        "  Ctrl/Cmd+Z       Undo",
        "  Ctrl/Cmd+Y       Redo",
        "  Ctrl/Cmd+Shift+Z Redo",
      ].join("\n"),
    );
  },
});

menuRegistry.register("Help", {
  id: "help.github",
  label: "GitHub",
  action: () => {
    window.open("https://github.com/Ibrahim-3d/lightbaker-web", "_blank");
  },
});

menuRegistry.register("Help", {
  id: "help.about",
  label: "About",
  separatorBefore: true,
  action: () => {
    alert(
      "LightBaker Studio - public Three.js authoring with private platform baking.\nSource: github.com/Ibrahim-3d/lightbaker-web",
    );
  },
});
