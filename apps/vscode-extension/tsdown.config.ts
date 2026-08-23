import { defineConfig } from "tsdown";

/**
 * CommonJS, unlike the rest of the repo: VSCode loads extensions as CJS. `vscode` itself is provided
 * by the host at runtime, so it must stay external.
 */
export default defineConfig({
  entry: "src/extension.ts",
  format: "cjs",
  dts: true,
  external: ["vscode"],
});
