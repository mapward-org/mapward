import type { ReactNode } from "react";

/** Buttons appear on hover so a still sidebar stays quiet — requirements, «Метрики». */
export function MetricCell(props: {
  label: string;
  freshness?: string;
  ok?: boolean;
  busy: boolean;
  hidden: boolean;
  gridArea: string;
  onRefresh: () => void;
  onToggle: () => void;
  onLogs?: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ gridArea: props.gridArea }} className="group min-w-0">
      <div className="flex items-center gap-1 text-[11px] uppercase opacity-70">
        <span className="truncate">{props.label}</span>

        {props.busy && <span className="animate-pulse">…</span>}
        {!props.busy && props.ok !== undefined && (
          <button
            type="button"
            onClick={props.onLogs}
            title="Открыть логи"
            className={props.ok ? "text-green-500" : "text-red-500"}
          >
            ●
          </button>
        )}
        {props.freshness && <span className="opacity-60">{props.freshness}</span>}

        <span className="ml-auto hidden gap-1 group-hover:flex">
          <button type="button" onClick={props.onRefresh} title="Обновить">
            ↻
          </button>
          <button
            type="button"
            onClick={props.onToggle}
            title={props.hidden ? "Показать" : "Скрыть"}
          >
            {props.hidden ? "+" : "−"}
          </button>
        </span>
      </div>

      {!props.hidden && <div className="min-w-0 break-words">{props.children}</div>}
    </div>
  );
}
