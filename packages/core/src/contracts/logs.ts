import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeSubscription } from "./bridge.ts";

/**
 * Логи — `.mapward/logs/` карты: файл на плагин и `mapward.log` для самой платформы и входов MCP.
 * Пишет их одна платформа, строкой JSON на запись: плагин зовёт свой `ctx.log`, а трейс, номер
 * вызова, объект и метод к строке приклеивает она. Логи и запуски разделены: запуск — трейс, а
 * поток строк фильтруется по нему.
 */

/** Имя файла платформы: начала и концы трейсов, входы MCP, её собственные ошибки. */
export const PLATFORM_LOG = "mapward";

/**
 * Вид записи:
 * - `trace-start`, `trace-end` — начало и конец трейса: этими строками прогон и сохраняется;
 * - `call-start`, `call-end` — вызов метода плагина внутри трейса;
 * - `step`, `log`, `error`, `out` — ход вызова: начался шаг, строка хода, ошибка, вывод;
 * - `stderr` — печать процесса плагина мимо `ctx`;
 * - `mcp` — инструмент MCP: что позвали, сколько шёл, чем кончился.
 */
export const LogKind = T.Union([
  T.Literal("trace-start"),
  T.Literal("trace-end"),
  T.Literal("call-start"),
  T.Literal("call-end"),
  T.Literal("step"),
  T.Literal("log"),
  T.Literal("error"),
  T.Literal("out"),
  T.Literal("stderr"),
  T.Literal("mcp"),
]);
export type LogKind = Static<typeof LogKind>;

export const LogLine = T.Object({
  at: T.String(),
  kind: LogKind,
  /** Файл, где строка лежит: имя папки плагина или `mapward`. */
  file: T.String(),
  trace: T.Optional(T.String()),
  /** Номер вызова метода; у строки процесса без вызова его нет. */
  call: T.Optional(T.String()),
  /** Вызов, из которого этот сделан: так трейс складывается в дерево. */
  parent: T.Optional(T.String()),
  /** Объект карты, на котором всё началось. */
  object: T.Optional(T.String()),
  /** Путь папки плагина — у строк вызова. */
  plugin: T.Optional(T.String()),
  method: T.Optional(T.String()),
  text: T.Optional(T.String()),
  /** `trace-start`: что заведено — экшон, метрика, вызов MCP, вызов из интерфейса. */
  traceKind: T.Optional(T.String()),
  /** `trace-start`: адрес экшона или метрики. */
  target: T.Optional(T.String()),
  label: T.Optional(T.String()),
  source: T.Optional(T.String()),
  inputs: T.Optional(T.Record(T.String(), T.Unknown())),
  config: T.Optional(T.Unknown()),
  /** `trace-end`, `call-end`: чем кончилось. */
  status: T.Optional(T.String()),
  result: T.Optional(T.Unknown()),
  error: T.Optional(T.String()),
  /** Сколько шло, мс — у концов и у `mcp`. */
  ms: T.Optional(T.Number()),
});
export type LogLine = Static<typeof LogLine>;

/**
 * Что смотреть. Пустой фильтр — всё по карте: это вид для отладки, а не основной. Основной — по
 * объекту, по плагину на объекте и по трейсу.
 */
export const LogFilter = T.Object({
  trace: T.Optional(T.String()),
  object: T.Optional(T.String()),
  /** Имя файла плагина, как в `LogLine.file`. */
  file: T.Optional(T.String()),
});
export type LogFilter = Static<typeof LogFilter>;

/**
 * Трейс вызова: номер и объект, на котором всё началось. Уходит вниз сам — во вложенные вызовы,
 * в окружение процессов (`MAPWARD_TRACE`), в MCP заголовком `x-mapward-trace`.
 */
export type TraceRef = {
  trace: string;
  /** Вызов, из которого сделан этот. */
  parent?: string;
  object?: string;
};

/** Имя переменной окружения и заголовка, которыми трейс уходит в процессы и в MCP. */
export const TRACE_ENV = "MAPWARD_TRACE";
export const TRACE_HEADER = "x-mapward-trace";
/** Ключ `_meta` вызова MCP, куда транспорт кладёт трейс из заголовка. */
export const TRACE_META = "mapward/trace";

export const logsBridge = {
  /** Строки по фильтру: сначала хвост из файлов, потом новые по мере записи — пачками. */
  watchLogs: createBridgeSubscription(
    T.Object({ mapPath: T.String(), filter: LogFilter, limit: T.Optional(T.Number()) }),
    T.Array(LogLine),
  ),
};
