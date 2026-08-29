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
        <button
          type="button"
          onClick={props.onToggle}
          title={props.hidden ? "Показать" : "Скрыть"}
          className="shrink-0 opacity-60 hover:opacity-100"
        >
          <svg
            viewBox="0 0 16 16"
            className={`size-4 transition-transform ${props.hidden ? "" : "rotate-90"}`}
          >
            <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>

        <span className="truncate">{props.label}</span>

        {props.busy && <span className="animate-pulse">…</span>}
        {!props.busy && props.ok !== undefined && (
          <button type="button" onClick={props.onLogs} title="Открыть логи" className="shrink-0">
            <span className={props.ok ? "text-green-500" : "text-red-500"}>●</span>
          </button>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={props.onRefresh}
            title="Обновить"
            className="hidden opacity-60 group-hover:block hover:opacity-100"
          >
            <svg viewBox="0 0 16 16" className="size-4">
              <path
                d="M13 8a5 5 0 1 1-1.6-3.7M13 3v2.5h-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {props.freshness && <span className="opacity-60">{props.freshness}</span>}
        </span>
      </div>

      {!props.hidden && <div className="min-w-0 break-words">{props.children}</div>}
    </div>
  );
}
