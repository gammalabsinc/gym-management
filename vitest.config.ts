import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
