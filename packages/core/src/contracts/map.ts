import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "./bridge.ts";

/** Which map to read: the sidebar may hold several at once. */
export const MapRef = T.Object({
  mapPath: T.String(),
  basePath: T.String(),
  name: T.String(),
});

/**
 * The map is a tree, and typebox cannot describe a recursive shape without ceremony. Params
 * are validated because they cross from the webview; results come from our own host code and
 * are typed on the client instead.
 */
/** Что умеет хост, поднявший сервер — решение 0014: клиент не рисует того, чего нет. */
export const Capabilities = T.Object({
  terminals: T.Boolean(),
  openFile: T.Boolean(),
  ask: T.Boolean(),
  /** Умеет ли хост показать текст без файла на диске — решение 0019. */
  virtualDocs: T.Boolean(),
  /**
   * Умеет ли хост открыть объект отдельным табом — решение 0026. Не умеет — иконок «в табе»
   * нет вовсе: ссылка, которая никуда не ведёт, хуже её отсутствия (0014).
   */
  tabs: T.Boolean(),
});

export const mapBridge = {
  getMap: createBridgeMethod(MapRef, T.Unknown()),
  watchMap: createBridgeSubscription(MapRef, T.Unknown()),
  getCapabilities: createBridgeMethod(T.Void(), Capabilities),
  /**
   * Значения метрик объекта. Подписка — это и есть «объект открыт»: пока она жива, сервер
   * держит метрики свежими, отписались — гасит интервалы (решение 0013).
   *
   * С группами открыт не объект, а вкладка: `group` отбирает метрики до сбора, и у закрытой
   * вкладки не тикают интервалы и не живут вотчеры — решение 0025.
   */
  watchMetrics: createBridgeSubscription(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.Optional(T.String()),
      group: T.Optional(T.String()),
      /**
       * Ключи метрик поверх группы: таб одной метрики открыт ради неё одной, и поднимать
       * ради него всю вкладку незачем — решение 0026.
       */
      metrics: T.Optional(T.Array(T.String())),
    }),
    T.Unknown(),
  ),
  /**
   * Открыть объект отдельным табом редактора — решение 0026. Таб всегда показывает объект;
   * `group` говорит, какая вкладка в нём открыта, `metric` — что показана одна метрика во всю
   * ширину, без шапки и соседей.
   */
  openInTab: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      group: T.Optional(T.String()),
      metric: T.Optional(T.String()),
    }),
    T.Void(),
  ),
  runMetric: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      metric: T.String(),
    }),
    T.Unknown(),
  ),
};

/** Creating a directive is a host job: it writes a file and opens it for editing. */
export const directiveBridge = {
  createDirective: createBridgeMethod(
    T.Object({ objectPath: T.String() }),
    T.Object({ path: T.String() }),
  ),
  /**
   * Удаление — такая же работа хоста: он спрашивает, точно ли, а файл и состояние прогонов
   * убирает сервер. Отказались от удаления или файла у объекта нет — приходит `deleted: false`.
   */
  deleteDirective: createBridgeMethod(
    T.Object({ objectPath: T.String(), directive: T.String() }),
    T.Object({ deleted: T.Boolean() }),
  ),
};

/**
 * Терминал — сессия агента, и заводится он на объект, а не на директиву: директив у объекта
 * много, этапов у каждой несколько, и всё это греет один контекст — решение 0017.
 *
 * Адресуется сессия идентификатором, а не именем: имя вкладки меняется, пока идёт этап.
 */
export const terminalBridge = {
  openObjectTerminal: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      fresh: T.Optional(T.Boolean()),
    }),
    T.Object({ id: T.String(), name: T.String() }),
  ),
  /**
   * Запустить этап кнопкой: хост отправляет в живую сессию объекта фразу «выполни этап такой-то
   * по директиве такой-то» — то же самое, что человек набрал бы руками (решение 0017). Промпт
   * этапа кнопка не несёт: его агент берёт из MCP сам.
   */
  runStage: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.String(),
      directive: T.String(),
      stage: T.String(),
    }),
    T.Object({ id: T.String(), name: T.String() }),
  ),
  /** Показать уже открытый терминал: список даёт идентификатор, имя — только для глаз. */
  showTerminal: createBridgeMethod(T.Object({ id: T.String() }), T.Void()),
  listTerminals: createBridgeMethod(
    T.Object({ address: T.String() }),
    T.Array(T.Object({ id: T.String(), name: T.String() })),
  ),
  closeTerminal: createBridgeMethod(T.Object({ id: T.String() }), T.Void()),
};

export type Capabilities = Static<typeof Capabilities>;
