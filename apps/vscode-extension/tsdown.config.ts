import { defineConfig } from "tsdown";

/**
 * Two bundles, one per runtime. The extension is CommonJS because VSCode loads extensions that
 * way and `vscode` is provided by the host. The webview is a browser module with no module
 * resolver behind it, so everything it uses has to be bundled in.
 */
export default defineConfig([
  {
    entry: { extension: "src/apps/extension/main.ts" },
    // Tailwind writes webview.css into the same dist; a blanket clean would race it away.
    clean: ["dist/*.cjs"],
    format: "cjs",
    dts: false,
    platform: "node",
    deps: { neverBundle: ["vscode"] },
  },
  {
    entry: { webview: "src/apps/webview/main.tsx" },
    clean: ["dist/*.mjs"],
    format: "esm",
    dts: false,
    platform: "browser",
    deps: { alwaysBundle: [/.*/] },
  },
]);
