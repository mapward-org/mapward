import type { ReactNode } from "react";
import type { Turn } from "@mapward/core";
import { badge, turnLabel, waited } from "../pure-model/turns.ts";

/**
 * Кнопка с числом внизу сайдбара, поверх карты, и список над ней — решение 0034. Не всплывашка:
 * она не отвлекает, пока человек думает о другом, а ждёт, когда он сам посмотрит.
 *
 * Список открывается кликом, не наведением, как остальные меню карты (решение 0028).
 */
export function TurnsDock(props: {
  /** Элемент, клик мимо которого закрывает список. */
  hold: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div ref={props.hold} className="fixed right-3 bottom-3 z-40 flex flex-col items-end gap-1">
      {props.children}
    </div>
  );
}

export function TurnsList(props: { children: ReactNode }) {
  return (
    <div className="flex max-h-[60vh] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
      <div className="px-3 py-0.5 text-[11px] text-[var(--mw-descriptionForeground)]">
        Ждут ответа
      </div>
      {props.children}
    </div>
  );
}

export function TurnItem(props: {
  turn: Turn;
  /** «Сколько ждёт» стареет само: пока список открыт, время приходит свежим раз в минуту. */
  now: number;
  onTake: (turn: Turn) => void;
}) {
  const { turn } = props;
  return (
    <button
      type="button"
      title={turn.path}
      onClick={() => props.onTake(turn)}
      className="flex w-full items-baseline gap-2 px-3 py-0.5 text-left text-[11px] hover:bg-[var(--mw-list-hoverBackground)]"
    >
      <span className="min-w-0 flex-1 truncate opacity-90">{turnLabel(turn)}</span>
      <span className="shrink-0 text-[var(--mw-descriptionForeground)]">
        {waited(turn.at, props.now)}
      </span>
    </button>
  );
}

export function TurnsBadge(props: { count: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      title={`Ждут ответа: ${props.count}`}
      onClick={props.onToggle}
      className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--mw-badge-background,var(--mw-button-background))] px-2 text-[12px] font-semibold text-[var(--mw-badge-foreground,var(--mw-button-foreground))] shadow-lg hover:opacity-90"
    >
      {badge(props.count)}
    </button>
  );
}
