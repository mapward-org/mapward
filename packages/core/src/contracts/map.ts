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
});

export const mapBridge = {
  getMap: createBridgeMethod(MapRef, T.Unknown()),
  watchMap: createBridgeSubscription(MapRef, T.Unknown()),
  getCapabilities: createBridgeMethod(T.Void(), Capabilities),
  /**
   * Значения метрик объекта. Подписка — это и есть «объект открыт»: пока она жива, сервер
   * держит метрики свежими, отписались — гасит интервалы (решение 0013).
   */
  watchMetrics: createBridgeSubscription(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      address: T.Optional(T.String()),
    }),
    T.Unknown(),
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
};

/**
 * Терминал — сессия агента, и заводится он на объект, а не на директиву: директив у объекта
 * много, этапов у каждой несколько, и всё это греет один контекст — решение 0017. Запускать
 * директиву мостом больше нечем: это делает человек словами в терминале.
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
    T.Object({ name: T.String() }),
  ),
  /** Показать уже открытый терминал: список даёт имя, и оно не равно имени объекта. */
  showTerminal: createBridgeMethod(T.Object({ name: T.String() }), T.Void()),
  listTerminals: createBridgeMethod(
    T.Object({ address: T.String() }),
    T.Array(T.Object({ name: T.String() })),
  ),
  closeTerminal: createBridgeMethod(T.Object({ name: T.String() }), T.Void()),
};

export type Capabilities = Static<typeof Capabilities>;
