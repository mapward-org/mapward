import type { Run, RunSource, RunStatus } from "@mapward/core";

/**
 * Экран прогонов — решение 0038. Прогоны приходят свежими сверху, экшоны и метрики вместе:
 * история у них общая, и здесь только то, что вид с ней делает.
 */

/** Последний прогон экшона или метрики: на него ведёт красная точка метрики. */
export const lastRun = (runs: Run[], target: string): Run | undefined =>
  runs.find((run) => run.target === target);

/** Сколько прогонов цели идёт сейчас: прогоны одного экшона бывают параллельными. */
export const runningCount = (runs: Run[], target: string): number =>
  runs.filter((run) => run.target === target && run.status === "running").length;

/**
 * Какой прогон открыт справа: названный, если он ещё есть, иначе самый свежий. Прогон мог
 * уйти из последних, пока экран висел в истории, — тогда пустой правой половины нет.
 */
export const pickRun = (runs: Run[], id: string | undefined): Run | undefined =>
  (id === undefined ? undefined : runs.find((run) => run.id === id)) ?? runs[0];

/** Откуда запуск — словом: имени человека карта не знает, важно, кто нажал (решение 0038). */
export const sourceLabel: Record<RunSource, string> = {
  ui: "кнопка",
  display: "строка дисплея",
  mcp: "агент",
  cli: "терминал",
  refresh: "сама",
  action: "после экшона",
};

/**
 * Вкладки экрана прогонов. Метрики собираются часто — при каждом открытии объекта и по
 * интервалу, — и эти сборы топили бы экшоны. Поэтому то, что метрика запустила сама, лежит на
 * своей вкладке, а на «метриках» — запущенное кем-то: кнопкой, агентом, терминалом, экшоном.
 */
export type RunsTab = "all" | "actions" | "metrics" | "auto";

export const RUNS_TABS: { key: RunsTab; label: string }[] = [
  { key: "all", label: "все" },
  { key: "actions", label: "экшоны" },
  { key: "metrics", label: "метрики" },
  { key: "auto", label: "автоматические метрики" },
];

export function tabOf(run: Run): Exclude<RunsTab, "all"> {
  if (run.kind === "action") return "actions";
  return run.source === "refresh" ? "auto" : "metrics";
}

export const inTab = (runs: Run[], tab: RunsTab): Run[] =>
  tab === "all" ? runs : runs.filter((run) => tabOf(run) === tab);

export const statusLabel: Record<RunStatus, string> = {
  running: "идёт",
  success: "прошёл",
  failure: "упал",
  stopped: "остановлен",
};

/** Цвета — те же, что у статусов метрик: прогон читается так же, как точка на клетке. */
export const statusColor: Record<RunStatus, string> = {
  running: "var(--mw-testing-iconQueued, #d29922)",
  success: "var(--mw-testing-iconPassed, #3fb950)",
  failure: "var(--mw-testing-iconFailed, #f85149)",
  stopped: "var(--mw-descriptionForeground, #8b949e)",
};

/** «1 мин 5 с»: сколько шёл прогон или шаг; идущий — до сейчас. */
export function duration(from: string, to: string | undefined, now: number): string {
  const end = to === undefined ? now : Date.parse(to);
  const seconds = Math.max(0, Math.round((end - Date.parse(from)) / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин ${seconds % 60} с`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Когда начался: сегодняшний — временем, прежний — ещё и датой. */
export function startedLabel(iso: string, now: number): string {
  const at = new Date(iso);
  const today = new Date(now);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return at.toDateString() === today.toDateString()
    ? time
    : `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`;
}

/** Конфиг и данные формы — текстом, как их читают: json с отступами. */
export const pretty = (value: unknown): string => JSON.stringify(value, null, 2) ?? "";
