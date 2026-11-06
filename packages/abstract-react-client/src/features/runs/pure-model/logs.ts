import { PLATFORM_LOG, type LogFilter, type LogLine } from "@mapward/core";
import { statusLabel } from "./runs.ts";

/**
 * Экран прогонов — интерфейс к логам (директива «логи плагинов»). Основной вид — строки объекта,
 * с фильтром по плагину на объекте; «вся карта» — вид для отладки: чужие строки там шум, но
 * иногда искать надо именно в них. У выбранного прогона — строки его трейса.
 */
export type LogScope = "object" | "map";

export const LOG_SCOPES: { key: LogScope; label: string }[] = [
  { key: "object", label: "объект" },
  { key: "map", label: "вся карта · отладка" },
];

/** Что смотреть. `file` пустой — все файлы; трейс перекрывает остальное: он и так один. */
export function logFilter(view: {
  trace?: string | undefined;
  scope: LogScope;
  object: string;
  file: string;
}): LogFilter {
  if (view.trace !== undefined) return { trace: view.trace };
  return {
    ...(view.scope === "object" ? { object: view.object } : {}),
    ...(view.file === "" ? {} : { file: view.file }),
  };
}

/** Ключ фильтра: одинаковый фильтр — одна подписка. */
export const filterKey = (filter: LogFilter): string =>
  JSON.stringify([filter.trace ?? null, filter.object ?? null, filter.file ?? null]);

/**
 * Файлы плагинов, которые встретились в строках, по имени. Лог самой платформы сюда не входит:
 * `mapward` в ряду плагинов читался как ещё один плагин, у него своя кнопка. Выбранный остаётся в списке, даже если строк
 * у него в окне нет, — иначе фильтр не снять.
 */
export function logFiles(lines: LogLine[], chosen: string): string[] {
  const files = new Set(lines.map((line) => line.file));
  if (chosen !== "") files.add(chosen);
  files.delete(PLATFORM_LOG);
  return [...files].toSorted((a, b) => a.localeCompare(b));
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/**
 * Время строки — до миллисекунды, как у pino-pretty: строки одного вызова идут плотно, и порядок
 * внутри секунды важен. Дата почти всегда сегодняшняя — её видно в подсказке.
 */
export function lineTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? at
    : `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Цвет уровня: свой у начала, вызова, удачи, провала, шага, хода и вывода. */
export type LevelTone = "start" | "call" | "ok" | "fail" | "stop" | "step" | "info" | "out" | "mcp";

/** Уровень строки — короткое слово заглавными, как `INFO` у pino: глаз ищет его в колонке. */
export function lineLevel(line: LogLine): { label: string; tone: LevelTone } {
  const ended = (label: string) =>
    line.status === "failure"
      ? { label: "FAIL", tone: "fail" as const }
      : line.status === "stopped"
        ? { label: "STOP", tone: "stop" as const }
        : { label, tone: "ok" as const };
  switch (line.kind) {
    case "trace-start":
      return { label: "START", tone: "start" };
    case "trace-end":
      return ended("END");
    case "call-start":
      return { label: "CALL", tone: "call" };
    case "call-end":
      return ended("DONE");
    case "step":
      return { label: "STEP", tone: "step" };
    case "log":
      return { label: "INFO", tone: "info" };
    case "error":
      return { label: "ERROR", tone: "fail" };
    case "out":
      return { label: "OUT", tone: "out" };
    case "stderr":
      return { label: "STDERR", tone: "stop" };
    case "mcp":
      return line.status === "failure"
        ? { label: "MCP", tone: "fail" }
        : { label: "MCP", tone: "mcp" };
  }
}

const TRACE_WORD: Record<string, string> = {
  action: "экшон",
  metric: "метрика",
  mcp: "mcp",
  call: "вызов",
};

/**
 * О ком строка — подписями, `плагин: shell · метод: json`: строки разных плагинов идут одним
 * потоком, и сущность должна читаться сразу, а не угадываться по склейке. У платформы своё:
 * инструмент MCP или прогон, который она завела.
 */
export function lineSource(line: LogLine): [string, string][] {
  if (line.file !== PLATFORM_LOG) {
    return [
      ["плагин", line.file],
      ...(line.method === undefined ? [] : [["метод", line.method] as [string, string]]),
    ];
  }
  if (line.kind === "mcp") return [["инструмент mcp", line.method ?? ""]];
  if (line.kind === "trace-start" || line.kind === "trace-end") {
    return [
      [
        "прогон",
        line.traceKind === undefined ? "" : (TRACE_WORD[line.traceKind] ?? line.traceKind),
      ],
    ];
  }
  return [["платформа", PLATFORM_LOG]];
}

const statusWord = (status: string) =>
  Object.hasOwn(statusLabel, status) ? statusLabel[status as keyof typeof statusLabel] : status;

/** Сообщение строки: что за прогон, чем кончилось и сколько шло, сам текст — через точку. */
export function lineMessage(line: LogLine): string {
  const parts = [
    line.kind === "trace-start" ? (line.label ?? line.target) : undefined,
    line.status === undefined ? undefined : statusWord(line.status),
    line.ms === undefined ? undefined : `${line.ms} мс`,
    line.text,
  ];
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

const shown = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, undefined, 2);

/**
 * Поля под строкой, с отступом, `ключ: значение` — как pino-pretty раскрывает объект записи.
 * Объект — только когда строки не одного объекта: на экране объекта он у всех один.
 */
export function lineFields(line: LogLine, withObject: boolean): [string, string][] {
  const fields: [string, unknown][] = [
    ["error", line.error],
    ["object", withObject ? line.object : undefined],
    ["target", line.kind === "trace-start" && line.label !== undefined ? line.target : undefined],
    ["source", line.source],
    ["inputs", line.inputs],
    ["config", line.config],
    ["result", line.result],
  ];
  return fields
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => [key, shown(value)]);
}
