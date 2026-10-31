import { defineConfig } from "tsdown";

/**
 * Пакет собирается одним файлом со всеми зависимостями: этот файл платформа и подставляет в
 * сборку каждого плагина как `@mapward/plugin`. У плагина в карте `node_modules` нет, поэтому
 * модель карты (`@mapward/core`), файлы потоками (`@mapward/vfs` с `rxjs`) и схемы (`typebox`)
 * едут внутри — снаружи пакет не зависит ни от кого. `rxjs` и `typebox` едут целиком: их же
 * платформа отдаёт плагину (`platformModules`).
 *
 * Типы модели и файлов в объявлениях остаются ссылкой на `@mapward/core` и `@mapward/vfs`, а
 * потоков и схем — на `rxjs` и `typebox` (они в `dependencies` ради этого): сборщик объявлений не
 * строит их из чужого пакета, а копия типов разошлась бы с оригиналом.
 */
export default defineConfig({
  entry: "src/index.ts",
  format: "esm",
  platform: "node",
  dts: true,
  deps: {
    alwaysBundle: [/.*/],
    onlyBundle: false,
    dts: { neverBundle: [/^@mapward\/(core|vfs)/, /^rxjs/, /^typebox/] },
  },
});
