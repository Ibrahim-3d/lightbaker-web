import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";

export default defineConfig({
  base: "./",
  plugins: [preact()],
  resolve: {
    alias: {
      shared: fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
      "demo-shell": fileURLToPath(
        new URL("./packages/demo-shell/src", import.meta.url),
      ),
    },
  },
});
