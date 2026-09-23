import type { ReactNode } from "react";
import type { Run, RunStatus, RunStep } from "@mapward/core";
import {
  duration,
  pretty,
  RUNS_TABS,
  type RunsTab,
  sourceLabel,
  startedLabel,
  statusColor,
  statusLabel,
} from "../pure-model/runs.ts";

function Dot(props: { status: RunStatus }) {
  return (
    <span
      className={`shrink-0 ${props.status === "running" ? "animate-pulse" : ""}`}
      style={{ color: statusColor[props.status] }}
      title={statusLabel[props.status]}
    >
      ●
    </span>
  );
}

/** Лог и вывод — моноширинно и с переносом: строки скрипта длинные, а сайдбар узкий. */
function Text(props: { title: string; text: string; error?: boolean }) {
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

function Block(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="m-0 text-[11px] font-normal uppercase opacity-60">{props.title}</h3>
      {props.children}
    </section>
  );
}

function Step(props: { step: RunStep; index: number; now: number }) {
  const { step } = props;
  return (
    <li className="flex flex-col gap-1 border-l border-[var(--mw-menu-border,#8884)] pl-2">
      <div className="flex items-center gap-1.5">
        <Dot status={step.status} />
        <span className="opacity-60">{props.index + 1}.</span>
        <span className="truncate">{step.name}</span>
        <span className="ml-auto shrink-0 text-[11px] opacity-60">
          {duration(step.startedAt, step.finishedAt, props.now)}
        </span>
      </div>
      {step.output && <Text title="результат" text={step.output} />}
      {step.log && <Text title="лог" text={step.log} error={step.status === "failure"} />}
    </li>
  );
}

function Details(props: { run: Run; now: number; onStop?: (id: string) => void }) {
  const { run, now } = props;
  const inputs = run.inputs ?? {};
  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <Dot status={run.status} />
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

      {run.error && <Text title="почему" text={run.error} error />}

      {Object.keys(inputs).length > 0 && (
        <Block title="Данные формы">
          <dl className="m-0 flex flex-col text-[11px]">
            {Object.entries(inputs).map(([name, value]) => (
              <div key={name} className="flex gap-2">
                <dt className="w-28 shrink-0 truncate opacity-70" title={name}>
                  {name}
                </dt>
                <dd className="m-0 font-mono break-words whitespace-pre-wrap">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      <Block title="Шаги">
        {run.steps.length === 0 ? (
          <span className="text-[11px] opacity-60">шагов пока нет</span>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {run.steps.map((step, index) => (
              <Step key={`${index}-${step.name}`} step={step} index={index} now={now} />
            ))}
          </ol>
        )}
      </Block>

      {/* Конфиг — после подстановок: тот, по которому прогон действительно шёл. */}
      {run.config !== undefined && (
        <Block title="Конфиг">
          <Text title="после подстановок" text={pretty(run.config)} />
        </Block>
      )}
    </div>
  );
}

/**
 * Экран прогонов объекта — решение 0038, по образцу мета-экрана: третий режим того же объекта.
 * Слева прогоны, свежие сверху, экшоны и метрики вместе; справа выбранный. Общего списка на
 * карту нет: карта строится зонами, и чужие прогоны были бы шумом.
 */
export function RunsView(props: {
  runs: Run[];
  /** Сколько прогонов у объекта всего, на всех вкладках. */
  total: number;
  tab: RunsTab;
  onTab: (tab: RunsTab) => void;
  selected: Run | undefined;
  now: number;
  onSelect: (id: string) => void;
  onStop?: (id: string) => void;
}) {
  if (props.total === 0) {
    return <div className="p-3 opacity-60">прогонов у объекта ещё не было</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--mw-menu-border,#8884)] px-2 py-1">
        {RUNS_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => props.onTab(entry.key)}
            className={`rounded-sm px-1.5 text-[11px] hover:bg-[var(--mw-list-hoverBackground)] ${
              entry.key === props.tab
                ? "bg-[var(--mw-list-activeSelectionBackground,#8883)]"
                : "opacity-70"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <ul className="m-0 w-2/5 max-w-64 min-w-28 shrink-0 list-none overflow-y-auto border-r border-[var(--mw-menu-border,#8884)] p-0">
          {props.runs.length === 0 && (
            <li className="px-2 py-1 text-[11px] opacity-60">на этой вкладке прогонов нет</li>
          )}
          {props.runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => props.onSelect(run.id)}
                className={`flex w-full flex-col px-2 py-1 text-left hover:bg-[var(--mw-list-hoverBackground)] ${
                  run.id === props.selected?.id
                    ? "bg-[var(--mw-list-activeSelectionBackground,#8883)]"
                    : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-1">
                  <Dot status={run.status} />
                  <span className="truncate">{run.label}</span>
                </span>
                <span className="truncate pl-3 text-[11px] opacity-60">
                  {run.kind === "action" ? "экшон" : "метрика"} · {sourceLabel[run.source]} ·{" "}
                  {startedLabel(run.startedAt, props.now)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {props.selected && (
            <Details
              run={props.selected}
              now={props.now}
              {...(props.onStop === undefined ? {} : { onStop: props.onStop })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
