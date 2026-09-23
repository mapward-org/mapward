import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Дисплей-компонент метрики собирает esbuild в WebAssembly — решение 0037. Сам esbuild
 * бандлится в расширение, а его `.wasm` бандлу не по зубам: он ложится в dist рядом, и порт
 * сборщика читает его оттуда.
 */
const require = createRequire(import.meta.url);
const source = path.join(
  path.dirname(require.resolve("esbuild-wasm/package.json")),
  "esbuild.wasm",
);

mkdirSync("dist", { recursive: true });
copyFileSync(source, path.join("dist", "esbuild.wasm"));
console.log("esbuild.wasm → dist");
