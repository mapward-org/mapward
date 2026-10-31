import * as T from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "./bridge.ts";

/**
 * Плагины по мосту: компонент метрики зовёт метод плагина, платформа маршрутизирует вызов в его
 * процесс. Мост своего конца у потока не знает, поэтому конец приходит событием `complete`, а
 * ошибка — отказом подписки.
 */
const PluginCall = T.Object({
  mapPath: T.String(),
  basePath: T.String(),
  name: T.String(),
  /** Абсолютный путь к папке плагина: от файла компонента его считает клиент. */
  plugin: T.String(),
  method: T.String(),
  args: T.Optional(T.Unknown()),
});

export const PluginEvent = T.Union([
  T.Object({ kind: T.Literal("next"), value: T.Unknown() }),
  T.Object({ kind: T.Literal("complete") }),
]);

export const pluginsBridge = {
  callPlugin: createBridgeSubscription(PluginCall, PluginEvent),
  /** Самоописание: методы, схемы, читающий или изменяющий. */
  describePlugin: createBridgeMethod(
    T.Object({ mapPath: T.String(), basePath: T.String(), name: T.String(), plugin: T.String() }),
    T.Unknown(),
  ),
};

export type PluginEvent = T.Static<typeof PluginEvent>;
