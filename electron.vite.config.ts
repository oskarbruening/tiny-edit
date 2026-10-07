import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Three build targets. No "type":"module" in package.json, so main and preload
// bundle to CommonJS — required for a sandboxed preload (see docs/architecture.md).
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {},
});
