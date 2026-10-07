import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/{main,preload,shared}/**/*.test.ts"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        test: {
          name: "renderer",
          environment: "happy-dom",
          include: ["tests/unit/renderer/**/*.test.ts"],
          setupFiles: ["tests/unit/renderer/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Wiring files are covered by Playwright E2E, not unit tests (see CLAUDE.md).
      exclude: ["src/main/index.ts", "src/preload/index.ts", "src/renderer/main.ts", "**/*.d.ts"],
      thresholds: { lines: 95 },
      reporter: ["text", "html"],
    },
  },
});
