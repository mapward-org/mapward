import type { ReactNode } from "react";
import type { Turn } from "@mapward/core";
import { badge, stateLabel, turnLabel, waited } from "../pure-model/turns.ts";

/**
 * Кнопка с числом внизу сайдбара, поверх карты, и лента над ней — решение 0046. Не всплывашка:
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
      {props.children}
    </div>
  );
}

/** Группа ленты со своим заголовком: «Идут» или «Ждут ответа». */
export function TurnsGroup(props: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col [&+&]:mt-1 [&+&]:border-t [&+&]:border-[var(--mw-menu-border,#8884)] [&+&]:pt-1">
      <div className="px-3 py-0.5 text-[11px] text-[var(--mw-descriptionForeground)]">
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

/** Крутящийся кружок: у идущего пункта и на кнопке, когда ждать нечего, а что-то идёт. */
const spinner = "block shrink-0 animate-spin rounded-full border-current border-t-transparent";

/**
 * Строка ленты: пункт и, у ждущего и упавшего, крестик справа. Кнопки соседние, а не
 * вложенные: кнопка в кнопке недопустима. Подсветка наведения — на всей строке.
 */
export function TurnRow(props: { children: ReactNode }) {
  return (
    <div className="group flex items-baseline text-[11px] hover:bg-[var(--mw-list-hoverBackground)]">
      {props.children}
    </div>
  );
}

export function TurnItem(props: {
  turn: Turn;
  /** «Сколько ждёт» стареет само: пока список открыт, время приходит свежим раз в минуту. */
  now: number;
  /** Рядом крестик: при наведении он встаёт на место времени. */
  dismissable?: boolean;
  onTake: (turn: Turn) => void;
}) {
  const { turn } = props;
  const state = stateLabel(turn);
  return (
    <button
      type="button"
      title={
        turn.kind === "directive"
          ? turn.path
          : `${turn.kind === "metric" ? "метрика" : "экшон"}, прогон ${turn.run}`
      }
      onClick={() => props.onTake(turn)}
      className={`flex min-w-0 flex-1 items-baseline gap-2 py-0.5 pr-3 pl-3 text-left ${props.dismissable ? "group-hover:pr-0" : ""}`}
    >
      <span className="min-w-0 flex-1 truncate opacity-90">{turnLabel(turn)}</span>
      {turn.state === "running" && (
        <span className="self-center text-[var(--mw-button-background)]">
          <span className={`${spinner} size-2.5 border-[1.5px]`} />
        </span>
      )}
      {state && (
        <span
          className={`shrink-0 ${turn.state === "failed" ? "text-[var(--mw-testing-iconFailed,#f85149)]" : "text-[var(--mw-descriptionForeground)]"}`}
        >
          {state}
        </span>
      )}
      <span
        className={`shrink-0 text-[var(--mw-descriptionForeground)] ${props.dismissable ? "group-hover:hidden" : ""}`}
      >
        {waited(turn.at, props.now)}
      </span>
    </button>
  );
}

/**
 * Убрать пункт, не открывая, — директиву, закрытую своим же этапом, смотреть не обязательно.
 * Виден при наведении на строку; список не закрывает, чтобы убрать подряд несколько.
 */
export function TurnDismiss(props: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      title="Убрать, не открывая"
      onClick={props.onDismiss}
      className="hidden shrink-0 px-2 opacity-60 group-hover:block hover:opacity-100"
    >
      ×
    </button>
  );
}

/**
 * Число — то, что ждёт человека. Ждать нечего, а что-то идёт — вместо числа крутится лоадер:
 * кнопка есть, но не зовёт.
 */
export function TurnsBadge(props: { count: number; busy: boolean; onToggle: () => void }) {
  const title = [props.count > 0 && `ждут: ${props.count}`, props.busy && "что-то идёт"]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      title={title}
      onClick={props.onToggle}
      className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--mw-badge-background,var(--mw-button-background))] px-2 text-[12px] font-semibold text-[var(--mw-badge-foreground,var(--mw-button-foreground))] shadow-lg hover:opacity-90"
    >
      {props.count > 0 ? badge(props.count) : <span className={`${spinner} size-3 border-2`} />}
    </button>
  );
}
