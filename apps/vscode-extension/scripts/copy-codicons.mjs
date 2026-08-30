import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * The webview cannot reach node_modules, so the font has to sit in dist next to the bundle
 * and be served through a webview uri.
 */
const require = createRequire(import.meta.url);
const source = path.join(
  path.dirname(require.resolve("@vscode/codicons/package.json")),
  "dist",
  "codicon.ttf",
);

mkdirSync("dist", { recursive: true });
copyFileSync(source, path.join("dist", "codicon.ttf"));
console.log("codicon.ttf → dist");
