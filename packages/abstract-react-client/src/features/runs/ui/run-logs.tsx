import type { ReactNode } from "react";
import type { LogLine } from "@mapward/core";
import {
  LOG_SCOPES,
  type LevelTone,
  type LogScope,
  lineLevel,
  lineMessage,
  lineSource,
  lineTime,
} from "../pure-model/logs.ts";

const chip = (active: boolean) =>
  `rounded-sm px-1.5 text-[11px] hover:bg-[var(--mw-list-hoverBackground)] ${
    active ? "bg-[var(--mw-list-activeSelectionBackground,#8883)]" : "opacity-70"
  }`;

/** Над логом объекта: чей лог и какой плагин. */
export function LogBar(props: { children: ReactNode }) {
  return <div className="flex flex-col gap-1">{props.children}</div>;
}

/** Объект — основной вид; вся карта — для отладки, поэтому вторым и с пометкой. */
export function LogScopes(props: { scope: LogScope; onScope: (scope: LogScope) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {LOG_SCOPES.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => props.onScope(entry.key)}
          className={chip(entry.key === props.scope)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Фильтр по плагину: файлы, чьи строки есть в виде; «все» — без фильтра. Лог самой платформы —
 * отдельной кнопкой после черты: это не плагин, а вызовы MCP и начало и конец прогонов.
 */
export function LogFiles(props: {
  files: string[];
  file: string;
  platform: string;
  onFile: (file: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] opacity-60">плагин:</span>
      {["", ...props.files].map((file) => (
        <button
          key={file}
          type="button"
          onClick={() => props.onFile(file)}
          className={chip(file === props.file)}
        >
          {file === "" ? "все" : file}
        </button>
      ))}
      <span className="mx-1 h-3 border-l border-[var(--mw-menu-border,#8884)]" />
      <button
        type="button"
        onClick={() => props.onFile(props.platform)}
        title="строки самого mapward: вызовы MCP, начало и конец прогонов"
        className={chip(props.platform === props.file)}
      >
        платформа mapward
      </button>
    </div>
  );
}

/**
 * Строки лога — старые сверху, новые снизу. Лог растёт по ходу, и окно держится у конца, пока
 * человек сам не отмотал вверх (`follow` ведёт стор).
 */
export function LogLines(props: {
  empty: boolean;
  follow: (element: HTMLElement | null) => (() => void) | undefined;
  children: ReactNode;
}) {
  return props.empty ? (
    <span className="text-[11px] opacity-60">строк в логе пока нет</span>
  ) : (
    <ol
      ref={props.follow}
      className="m-0 flex max-h-[60vh] list-none flex-col overflow-y-auto rounded-sm bg-[var(--mw-textBlockQuote-background,#8881)] p-1.5 font-mono text-[11px]"
    >
      {props.children}
    </ol>
  );
}

/** Выбранный трейс над логом: чей он и как снять. */
export function LogTrace(props: { trace: string; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="opacity-60">трейс:</span>
      <code className="font-mono">{props.trace}</code>
      <button type="button" onClick={props.onClear} className={chip(false)} title="снять фильтр">
        ✕ снять
      </button>
    </div>
  );
}

/** Цвета уровней — из темы редактора, как раскраска pino-pretty в терминале. */
const LEVEL: Record<LevelTone, string> = {
  start: "text-[var(--mw-charts-blue,#3794ff)]",
  call: "text-[var(--mw-descriptionForeground,#8888)]",
  ok: "text-[var(--mw-charts-green,#3a3)]",
  fail: "text-[var(--mw-errorForeground,#f85149)]",
  stop: "text-[var(--mw-charts-yellow,#cca700)]",
  step: "text-[var(--mw-charts-purple,#b180d7)]",
  info: "text-[var(--mw-charts-green,#3a3)]",
  out: "text-[var(--mw-descriptionForeground,#8888)]",
  mcp: "text-[var(--mw-charts-orange,#d18616)]",
};

/**
 * Строка лога в духе pino-pretty: первой строкой `[время] УРОВЕНЬ плагин.метод сообщение трейс`,
 * под ней с отступом поля записи — ошибка, данные формы, итог.
 */
export function LogRow(props: { head: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-col py-px">
      {props.head}
      {props.children}
    </li>
  );
}

const RED = "text-[var(--mw-errorForeground,#f85149)]";

/** Сущность — первой подписью синим, метод — фиолетовым: глаз отличает «кто» от «что». */
const SOURCE = ["text-[var(--mw-charts-blue,#3794ff)]", "text-[var(--mw-charts-purple,#b180d7)]"];

/** Первая строка записи: время, уровень, чья, сообщение и номер трейса. */
export function LogHead(props: { line: LogLine; trace: ReactNode }) {
  const { line } = props;
  const level = lineLevel(line);
  const source = lineSource(line);
  const message = lineMessage(line);
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="shrink-0 opacity-50" title={line.at}>
        [{lineTime(line.at)}]
      </span>
      <span className={`w-[6ch] shrink-0 font-bold ${LEVEL[level.tone]}`}>{level.label}</span>
      {source.map(([name, value], index) => (
        <span key={name} className="shrink-0">
          <span className="opacity-50">{value === "" ? name : `${name}:`}</span>{" "}
          <span className={`font-semibold ${SOURCE[index] ?? ""}`}>{value}</span>
        </span>
      ))}
      {message !== "" && (
        <span
          className={`min-w-0 break-words whitespace-pre-wrap ${level.tone === "fail" ? RED : ""}`}
        >
          {message}
        </span>
      )}
      {props.trace}
    </div>
  );
}

/**
 * Номер трейса — кнопка в рамке со стрелкой, «… →»: клик показывает весь трейс, через все плагины.
 * Голый номер цветом ссылки за кнопку не читался. У строк уже выбранного трейса — подпись.
 */
export function TraceLink(props: {
  trace: string;
  current: string | undefined;
  onTrace: (trace: string) => void;
}) {
  return props.trace === props.current ? (
    <span className="ml-auto shrink-0 opacity-40">{props.trace}</span>
  ) : (
    <button
      type="button"
      onClick={() => props.onTrace(props.trace)}
      title="показать весь трейс — строки всех плагинов"
      className="ml-auto shrink-0 cursor-pointer rounded-sm border border-[var(--mw-menu-border,#8884)] px-1 leading-[1.4] text-[var(--mw-textLink-foreground,#3794ff)] hover:bg-[var(--mw-list-hoverBackground)]"
    >
      {props.trace} →
    </button>
  );
}

/** Поле записи под строкой, с отступом: `ключ: значение`; ошибка — красным. */
export function LogField(props: { name: string; value: string }) {
  return (
    <div className="flex gap-1.5 pl-[2ch]">
      <span className="shrink-0 opacity-50">{props.name}:</span>
      <span
        className={`min-w-0 break-words whitespace-pre-wrap ${props.name === "error" ? RED : "opacity-80"}`}
      >
        {props.value}
      </span>
    </div>
  );
}
