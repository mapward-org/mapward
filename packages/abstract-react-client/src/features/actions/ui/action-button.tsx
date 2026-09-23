import type { ReactNode } from "react";
import { ActionsIcon, RunIcon } from "../../../lib/ui/icons.tsx";

/** Сколько прогонов идёт: число, а не просто «идёт» — прогоны одного экшона параллельны. */
export function ActionRunning(props: { count: number }) {
  if (props.count === 0) return null;
  return (
    <span className="shrink-0 animate-pulse text-[11px]" title={`идёт прогонов: ${props.count}`}>
      {props.count > 1 ? `…${props.count}` : "…"}
    </span>
  );
}

/**
 * Кнопка экшона в клетке раскладки — решение 0038: ключ экшона в `areas` ставит её так же, как
 * ключ метрики ставит метрику. Она же — `ActionButton` набора `@mapward/display`.
 */
export function ActionButton(props: {
  label: string;
  description?: string | undefined;
  /** Экшона нет: кнопка остаётся на месте и говорит об этом, а не пропадает молча. */
  missing?: string | undefined;
  /** Сколько прогонов идёт — рядом с подписью. */
  counter: ReactNode;
  onRun: () => void;
}) {
  if (props.missing) {
    return (
      <span className="text-[11px] text-[var(--mw-errorForeground,#f85149)]">
        нет экшона {props.missing}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onRun}
      title={props.description ?? props.label}
      className="flex min-w-0 items-center gap-1 self-start rounded-sm border border-[var(--mw-menu-border,#8884)] px-2 py-0.5 hover:bg-[var(--mw-list-hoverBackground)]"
    >
      <span className="shrink-0 opacity-80">{ActionsIcon}</span>
      <span className="truncate">{props.label}</span>
      {props.counter}
    </button>
  );
}

/**
 * Кнопка экшона на строке списка или узле дерева — справа, отдельно от строки: клик по самой
 * строке по-прежнему ведёт по `link` (решение 0038). Экшона нет — ошибка этой строки, а не
 * всей метрики: у соседних строк он может быть в порядке.
 */
export function RowActionButton(props: {
  label: string;
  missing?: string | undefined;
  counter: ReactNode;
  onRun: () => void;
}) {
  if (props.missing) {
    return (
      <span
        className="shrink-0 px-1 text-[11px] text-[var(--mw-errorForeground,#f85149)]"
        title={`нет экшона ${props.missing}`}
      >
        !
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center">
      {props.counter}
      <button
        type="button"
        onClick={props.onRun}
        title={`Запустить: ${props.label}`}
        className="shrink-0 rounded-sm px-1 opacity-60 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
      >
        {RunIcon}
      </button>
    </span>
  );
}
