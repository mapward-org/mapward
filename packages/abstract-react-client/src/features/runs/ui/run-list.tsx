import type { ReactNode } from "react";
import type { Run, RunStatus } from "@mapward/core";
import {
  RUNS_TABS,
  type RunsTab,
  sourceLabel,
  startedLabel,
  statusColor,
  statusLabel,
} from "../pure-model/runs.ts";

export function RunDot(props: { status: RunStatus }) {
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

export function RunsEmpty() {
  return <div className="p-3 opacity-60">прогонов у объекта ещё не было</div>;
}

/**
 * Экран прогонов объекта — решение 0038, по образцу мета-экрана: третий режим того же объекта.
 * Сверху вкладки, слева прогоны, справа выбранный.
 */
export function RunsFrame(props: { tabs: ReactNode; list: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {props.tabs}
      <div className="flex min-h-0 flex-1">
        {props.list}
        <div className="min-w-0 flex-1 overflow-y-auto">{props.children}</div>
      </div>
    </div>
  );
}

export function RunsTabs(props: { tab: RunsTab; onTab: (tab: RunsTab) => void }) {
  return (
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
  );
}

/** Прогоны свежими сверху, экшоны и метрики вместе. */
export function RunList(props: { empty: boolean; children: ReactNode }) {
  return (
    <ul className="m-0 w-2/5 max-w-64 min-w-28 shrink-0 list-none overflow-y-auto border-r border-[var(--mw-menu-border,#8884)] p-0">
      {props.empty && (
        <li className="px-2 py-1 text-[11px] opacity-60">на этой вкладке прогонов нет</li>
      )}
      {props.children}
    </ul>
  );
}

export function RunItem(props: {
  run: Run;
  now: number;
  selected: boolean;
  dot: ReactNode;
  onSelect: (id: string) => void;
}) {
  const { run } = props;
  return (
    <li>
      <button
        type="button"
        onClick={() => props.onSelect(run.id)}
        className={`flex w-full flex-col px-2 py-1 text-left hover:bg-[var(--mw-list-hoverBackground)] ${
          props.selected ? "bg-[var(--mw-list-activeSelectionBackground,#8883)]" : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-1">
          {props.dot}
          <span className="truncate">{run.label}</span>
        </span>
        <span className="truncate pl-3 text-[11px] opacity-60">
          {run.kind === "action" ? "экшон" : "метрика"} · {sourceLabel[run.source]} ·{" "}
          {startedLabel(run.startedAt, props.now)}
        </span>
      </button>
    </li>
  );
}
