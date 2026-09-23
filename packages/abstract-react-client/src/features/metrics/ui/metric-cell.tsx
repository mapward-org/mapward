import type { ReactNode } from "react";
import { cellAttribute } from "../pure-model/grid.ts";
import { TabIcon } from "../../../lib/ui/icons.tsx";
import { tabHover } from "../../../lib/ui/tab-hover.ts";

/**
 * Клетка метрики: шапка и содержимое. Клетке сетки ряд отмеряет высоту, и содержимое, которое в
 * неё не влезло, прокручивается внутри клетки, а не вылезает на соседей (решение 0029).
 * `min-h-0` здесь обязателен: без него flex-элемент не даёт себя сжать, и прокручивать
 * становится нечего.
 */
export function MetricCell(props: {
  /** Ключ, по которому клетку находит css раскладки; место в сетке назначает он. */
  cellKey?: string | undefined;
  header: ReactNode;
  hidden: boolean;
  children: ReactNode;
}) {
  return (
    <div
      {...(props.cellKey === undefined ? {} : { [cellAttribute]: props.cellKey })}
      className="group flex min-h-0 min-w-0 flex-col"
    >
      {props.header}
      {!props.hidden && (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto break-words">{props.children}</div>
      )}
    </div>
  );
}

/**
 * Buttons appear on hover so a still sidebar stays quiet. The chevron sits outside the flow:
 * appearing on hover must not shift the label sideways.
 */
export function CellHeader(props: { children: ReactNode }) {
  return (
    <div className="relative flex shrink-0 items-center gap-1 text-[11px] uppercase opacity-70">
      {props.children}
    </div>
  );
}

export function CellFold(props: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      title={props.hidden ? "Показать" : "Скрыть"}
      className="absolute -left-4 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
    >
      <svg
        viewBox="0 0 16 16"
        className={`size-4 transition-transform ${props.hidden ? "" : "rotate-90"}`}
      >
        <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  );
}

/**
 * Открыть метрику отдельным табом — решение 0026: ctrl + клик по названию и иконка рядом.
 * Иконка здесь остаётся (0035): название метрики ссылкой не выглядит, и жест по нему не
 * очевиден. Под ctrl название подчёркивается, как любая ссылка, открывающая таб.
 */
export function CellLabel(props: { label: string; onOpenTab?: (() => void) | undefined }) {
  return props.onOpenTab ? (
    <button
      type="button"
      title="Ctrl + клик — открыть отдельным табом"
      onClick={(event) => (event.ctrlKey || event.metaKey ? props.onOpenTab?.() : undefined)}
      className={`truncate text-left uppercase ${tabHover.tabOnly}`}
    >
      {props.label}
    </button>
  ) : (
    <span className="truncate">{props.label}</span>
  );
}

export function CellTabButton(props: { onOpenTab: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onOpenTab}
      title="Открыть отдельным табом"
      className="hidden shrink-0 opacity-60 group-hover:block hover:opacity-100"
    >
      {TabIcon}
    </button>
  );
}

export function CellBusy() {
  return <span className="animate-pulse">…</span>;
}

/**
 * Точка — только красная (решение 0038): зелёная стояла у каждой исправной метрики и шумела.
 * Ведёт она на последний прогон, где видно, какой шаг упал и что он сказал.
 */
export function CellFailed(props: { onRuns: () => void }) {
  return (
    <button type="button" onClick={props.onRuns} title="Последний прогон" className="shrink-0">
      <span style={{ color: "var(--mw-testing-iconFailed, #f85149)" }}>●</span>
    </button>
  );
}

export function CellRefresh(props: { onRefresh: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onRefresh}
      title="Обновить"
      className="hidden shrink-0 opacity-60 group-hover:block hover:opacity-100"
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
  );
}

export function CellFreshness(props: { text: string | undefined }) {
  return props.text ? <span className="ml-auto shrink-0 opacity-60">{props.text}</span> : null;
}
