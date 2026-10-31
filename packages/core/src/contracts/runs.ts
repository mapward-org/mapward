import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "./bridge.ts";

/**
 * Откуда пришёл запуск — решение 0038. Имени человека карта не знает, а локальным прогонам оно
 * и не нужно: важно, нажали это, попросил агент или набрали в терминале.
 */
export const RunSource = T.Union([
  T.Literal("ui"),
  T.Literal("display"),
  T.Literal("mcp"),
  T.Literal("cli"),
  /** Метрика собралась сама: при открытии объекта или по интервалу. */
  T.Literal("refresh"),
  /** Прежнее: метрика пересобрана после экшона. Экшон больше этого не делает. */
  T.Literal("action"),
  /** Метрику перезапустил вотчер шага: под его `watch` поменялся файл (решение 0043). */
  T.Literal("watch"),
]);

export const RunStatus = T.Union([
  T.Literal("running"),
  T.Literal("success"),
  T.Literal("failure"),
  T.Literal("stopped"),
]);

/** Шаг прогона: исполнитель экшона или стадия метрики, со своим логом и выводом. */
export const RunStep = T.Object({
  name: T.String(),
  status: RunStatus,
  startedAt: T.String(),
  finishedAt: T.Optional(T.String()),
  /** stderr и объяснение неудачи. */
  log: T.Optional(T.String()),
  /** stdout: то, что шаг отдал. */
  output: T.Optional(T.String()),
});

/**
 * Сообщение о ходе — так метод, которого позвал экшон, говорит, что делает: начался шаг, строка
 * вывода, строка хода и ошибок. Платформа пишет их в прогон по мере прихода; всё остальное, что
 * метод отдаёт, — его итог. Сам метод об истории не знает: зовут его и мимо экшона.
 */
export type RunMessage =
  | { progress: "step"; name: string }
  | { progress: "out" | "log"; text: string };

export function runMessage(value: unknown): RunMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { progress, name, text } = value as Record<string, unknown>;
  if (progress === "step" && typeof name === "string") return { progress, name };
  if ((progress === "out" || progress === "log") && typeof text === "string") {
    return { progress, text };
  }
  return undefined;
}

/**
 * Прогон экшона или метрики — решение 0038. Живёт локально, в `.mapward/runs/` карты: это
 * операционка, а не история проекта, и в git не попадает.
 */
export const Run = T.Object({
  id: T.String(),
  kind: T.Union([T.Literal("action"), T.Literal("metric")]),
  /** Адрес экшона или метрики. */
  target: T.String(),
  /** Объект, на котором шёл прогон. */
  object: T.String(),
  label: T.String(),
  source: RunSource,
  status: RunStatus,
  startedAt: T.String(),
  finishedAt: T.Optional(T.String()),
  inputs: T.Optional(T.Record(T.String(), T.Unknown())),
  /** Конфиг после подстановок — тот, по которому прогон действительно шёл. */
  config: T.Optional(T.Unknown()),
  steps: T.Array(RunStep),
  /** Итог метода: последнее его значение, которое не сообщение о ходе. */
  result: T.Optional(T.Unknown()),
  /** Почему прогон не удался, одной строкой. */
  error: T.Optional(T.String()),
});

export type RunSource = Static<typeof RunSource>;
export type RunStatus = Static<typeof RunStatus>;
export type RunStep = Static<typeof RunStep>;
export type Run = Static<typeof Run>;

/**
 * Итог запуска: номер прогона сразу, ещё до его конца, или ошибки полей формы — их проверяет
 * сервер, иначе MCP и терминал обходили бы обязательные поля.
 */
export const RunStarted = T.Object({
  id: T.Optional(T.String()),
  errors: T.Optional(T.Record(T.String(), T.String())),
});
export type RunStarted = Static<typeof RunStarted>;

export const runsBridge = {
  runAction: createBridgeMethod(
    T.Object({
      mapPath: T.String(),
      basePath: T.String(),
      name: T.String(),
      /** Адрес экшона. */
      action: T.String(),
      inputs: T.Optional(T.Record(T.String(), T.Unknown())),
      source: T.Optional(RunSource),
    }),
    RunStarted,
  ),
  stopRun: createBridgeMethod(T.Object({ mapPath: T.String(), id: T.String() }), T.Void()),
  /** Прогоны одного объекта, свежие сверху: ими питается экран прогонов. */
  watchRuns: createBridgeSubscription(
    T.Object({ mapPath: T.String(), address: T.String() }),
    T.Array(Run),
  ),
};
