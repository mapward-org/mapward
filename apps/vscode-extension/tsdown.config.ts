import { defineConfig } from "tsdown";

/**
 * Прод-режим включается переменной окружения, а не отдельным конфигом: сборка одна, и разойтись
 * двум конфигам негде. Ставит её `scripts/package-vsix.mjs` — руками эту переменную выставлять
 * не нужно, обычный `pnpm build` остаётся дев-сборкой с читаемыми стектрейсами react.
 */
const production = process.env.NODE_ENV === "production";

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
    // Бандлится всё, кроме `vscode`. В `.vsix` уезжает только `dist`, без `node_modules`, и
    // оставленный снаружи `require("@mapward/abstract-server")` там не резолвится: в отладочном
    // хосте он попадает в симлинки монорепы и работает, а установленное расширение падает на
    // активации, и сайдбар крутит спиннер вечно. Проверяется составом `require` в бандле.
    deps: { alwaysBundle: [/.*/], neverBundle: ["vscode"] },
  },
  {
    entry: { webview: "src/apps/webview/main.tsx" },
    clean: ["dist/*.mjs"],
    format: "esm",
    dts: false,
    platform: "browser",
    deps: { alwaysBundle: [/.*/] },
    // В вебвью нет резолвера и нет `process`: react читает `process.env.NODE_ENV` на входе,
    // и без этой подстановки в бандл уезжает дев-сборка со всеми проверками — 1.67 МБ.
    define: {
      "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
    },
    minify: production,
  },
]);
