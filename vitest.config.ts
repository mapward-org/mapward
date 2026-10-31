import { defineConfig } from "vitest/config";

/**
 * One runner for the whole repo: packages are small and share fixtures, and a single run is faster
 * than four cold starts.
 */
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      // Встроенные плагины держат тесты рядом с кодом: в карту они не копируются.
      "packages/plugins/registry/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    passWithNoTests: true,
  },
});
