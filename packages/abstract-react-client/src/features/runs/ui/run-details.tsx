import type { ReactNode } from "react";
import type { Run, RunStep as Step } from "@mapward/core";
import { duration, sourceLabel, startedLabel, statusLabel } from "../pure-model/runs.ts";

export function RunDetails(props: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 p-2">{props.children}</div>;
}

export function RunHeader(props: {
  run: Run;
  now: number;
  dot: ReactNode;
  onStop?: ((id: string) => void) | undefined;
}) {
  const { run, now } = props;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {props.dot}
        <span className="truncate font-medium">{run.label}</span>
        {/* Остановить можно, пока идёт: у каждого прогона своя остановка (0038). */}
        {run.status === "running" && props.onStop && (
          <button
            type="button"
            onClick={() => props.onStop?.(run.id)}
            className="ml-auto shrink-0 rounded-sm border border-[var(--mw-menu-border,#8884)] px-2 text-[11px] hover:bg-[var(--mw-list-hoverBackground)]"
          >
            остановить
          </button>
        )}
      </div>
      <div className="text-[11px] opacity-60">
        {run.kind === "action" ? "экшон" : "метрика"} · {sourceLabel[run.source]} ·{" "}
        {startedLabel(run.startedAt, now)} · {statusLabel[run.status]},{" "}
        {duration(run.startedAt, run.finishedAt, now)}
      </div>
      <div className="truncate text-[11px] opacity-60" title={run.target}>
        {run.target}
      </div>
    </div>
  );
}

/** Лог и вывод — моноширинно и с переносом: строки скрипта длинные, а сайдбар узкий. */
export function RunText(props: { title: string; text: string; error?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] uppercase opacity-60">{props.title}</div>
      <pre
        className={`m-0 rounded-sm bg-[var(--mw-textBlockQuote-background,#8881)] p-1.5 font-mono text-[11px] break-words whitespace-pre-wrap ${
          props.error ? "text-[var(--mw-errorForeground,#f85149)]" : ""
        }`}
      >
        {props.text}
      </pre>
    </div>
  );
}

export function RunBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="m-0 text-[11px] font-normal uppercase opacity-60">{props.title}</h3>
      {props.children}
    </section>
  );
}

/** Данные формы, с которыми запустили: имя слева, значение как есть справа. */
export function RunInputs(props: { inputs: [string, string][] }) {
  return (
    <dl className="m-0 flex flex-col text-[11px]">
      {props.inputs.map(([name, value]) => (
        <div key={name} className="flex gap-2">
          <dt className="w-28 shrink-0 truncate opacity-70" title={name}>
            {name}
          </dt>
          <dd className="m-0 font-mono break-words whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RunSteps(props: { empty: boolean; children: ReactNode }) {
  return props.empty ? (
    <span className="text-[11px] opacity-60">шагов пока нет</span>
  ) : (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">{props.children}</ol>
  );
}

/** Шаг прогона: строка с временем, под ней — что он вывел. */
export function RunStep(props: {
  step: Step;
  index: number;
  now: number;
  dot: ReactNode;
  children: ReactNode;
}) {
  const { step } = props;
  return (
    <li className="flex flex-col gap-1 border-l border-[var(--mw-menu-border,#8884)] pl-2">
      <div className="flex items-center gap-1.5">
        {props.dot}
        <span className="opacity-60">{props.index + 1}.</span>
        <span className="truncate">{step.name}</span>
        <span className="ml-auto shrink-0 text-[11px] opacity-60">
          {duration(step.startedAt, step.finishedAt, props.now)}
        </span>
      </div>
      {props.children}
    </li>
  );
}
