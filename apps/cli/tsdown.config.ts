import { defineConfig } from "tsdown";
import { raw } from "../../packages/abstract-server/tsdown.raw.ts";

export default defineConfig({
  entry: "src/cli.ts",
  format: "esm",
  dts: false,
  // CLI выходит в npm одним пакетом: свои пакеты монорепы (`@mapward/*`) не публикуются и едут
  // внутрь сборки — из исходников, по путям tsconfig, как у расширения, поэтому нужен и `?raw`
  // сервера. Снаружи остаются только зависимости из `dependencies` — их ставит npm.
  noExternal: [/^@mapward\//],
  plugins: [raw],
});
