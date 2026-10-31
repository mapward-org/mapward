/**
 * @mapward/plugin — серверная часть плагина карты.
 *
 * ```ts
 * import { definePlugin } from "@mapward/plugin";
 * import { of } from "rxjs";
 * import { Type } from "typebox";
 *
 * export default definePlugin({
 *   methods: {
 *     hello: {
 *       params: Type.Object({ name: Type.String() }),
 *       run: (args) => of(`привет, ${args.name}`),
 *     },
 *   },
 * });
 * ```
 *
 * В сборке плагина этот модуль подставляет платформа — собранный пакет со всеми зависимостями,
 * а не копию из `node_modules`; в проект пакет ставят ради типов.
 *
 * Здесь только API платформы для плагина: `definePlugin`, протокол, `ctx`, файлы потоками
 * (`createVfs`) и помощники потоков. Потоки — rxjs, схемы — typebox: их тоже даёт платформа
 * (`platformModules`), ставить их плагину не нужно. Предметных операций нет: правка карты — у
 * платформы (`ctx.editMap`), а мнения о карте (вьюха холста, стрелки) — код своих плагинов.
 */

export type * from "./types.ts";
export { definePlugin, resolveAddress, runPlugin, startStdio } from "./runtime.ts";
export type { PluginIo } from "./runtime.ts";

/** Метрика объекта, как её отдаёт `ctx.tree`. */
export type { MapMetric } from "@mapward/core";

/**
 * Проверка аргументов метода по его JSON-схеме (`params`): ошибка строкой на поле — путь и что
 * ожидалось. Агент шлёт что угодно, и метод, которому мало типов, проверяет сам до работы.
 */
export { schemaErrors } from "./schema.ts";

/**
 * Буква git — для плагина, который метит узлы дерева: её рисует клиент. Глобы — для того, кто
 * читает и сторожит файлы: так живут встроенные `files` и `shell`.
 */
export type { GitLetter, MetricConfig } from "@mapward/core";
export { excluded, globBase, matchesAny, matchesGlob } from "./glob.ts";

/**
 * Файлы потоками с точечной подпиской — `@mapward/vfs` на node: `createVfs(папка)`. Кирпичи для
 * сборки из этих потоков — здесь же: `PENDING` пока
 * читается, `follow` для зависимости из данных, `every` для частей, `settle` — одно значение на
 * пачку. Так живёт встроенный `files`.
 */
export { createVfs, type Vfs, type VfsOptions } from "./vfs.ts";
export {
  every,
  follow,
  isReady,
  mapReady,
  PENDING,
  settle,
  type FileEntry,
  type FileStat,
  type Maybe,
  type Pending,
} from "@mapward/vfs";

/**
 * Для метода, которого зовёт экшон: сообщения о ходе (`{ progress: "out", text }` и др.) платформа
 * пишет в прогон, а данные формы `${{ inputs.<имя> }}` подставляет в текст сам метод. Так живут
 * встроенные `shell` и `agent`.
 */
export { fillInputs, runMessage } from "@mapward/core";
export type { RunMessage } from "@mapward/core";

/** rxjs и typebox для сборки плагина: платформа отдаёт их вместо `node_modules`. */
export { platformModules } from "./platform-modules.ts";
