import { defineConfig } from "@playwright/test";

const forceHighPerformanceGpu =
  process.env.BAKER_FORCE_HIGH_PERFORMANCE_GPU === "1";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: process.env.LUMEN_EVIDENCE_DIR
    ? `${process.env.LUMEN_EVIDENCE_DIR}/playwright`
    : "./test-results",
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ||
        (process.platform === "win32"
          ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
          : undefined),
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        ...(forceHighPerformanceGpu
          ? [
              "--use-webgpu-power-preference=force-high-performance",
              "--force-high-performance-gpu",
            ]
          : []),
      ],
    },
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: true,
  },
});
