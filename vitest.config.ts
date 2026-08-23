import { defineConfig } from "vitest/config";

/**
 * One runner for the whole repo: packages are small and share fixtures, and a single run is faster
 * than four cold starts.
 */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
