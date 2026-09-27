import type { ReactNode } from "react";
import { DirectivesIcon, NewDirectiveIcon } from "../../../lib/ui/icons.tsx";
import { Spinner } from "../../../lib/ui/spinner.tsx";

/**
 * Директивы объекта кнопкой с поиском — в шапке экрана и карточки. Выглядит как меню экшонов
 * рядом: две кнопки одной шапки, и различаться им незачем, кроме иконки.
 */
export function DirectiveMenuBox(props: {
  hold: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div ref={props.hold} className="relative flex">
      {props.children}
    </div>
  );
}

/**
 * Кнопка меню. Число — незакрытые директивы: списком на экране они больше не висят, и счёт на
 * кнопке не даёт о них забыть (решение 0045). Нет незакрытых — нет и числа.
 */
export function DirectiveMenuButton(props: {
  count: number;
  onToggle: (button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      title={props.count > 0 ? `Директивы: незакрытых ${props.count}` : "Директивы"}
      onClick={(event) => props.onToggle(event.currentTarget)}
      className="flex items-center gap-0.5 rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
    >
      {DirectivesIcon}
      {props.count > 0 && <span className="text-[10px] leading-none">{props.count}</span>}
    </button>
  );
}

export function DirectiveMenuPanel(props: { children: ReactNode }) {
  return (
    <div className="flex max-h-[60vh] w-72 flex-col rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
      {props.children}
    </div>
  );
}

/** Поиск стоит сразу; Enter открывает первую найденную директиву, Escape закрывает меню. */
export function DirectiveSearch(props: {
  query: string;
  onQuery: (query: string) => void;
  onClose: () => void;
  onFirst: () => void;
}) {
  return (
    <input
      autoFocus
      type="search"
      value={props.query}
      placeholder="найти директиву"
      onChange={(event) => props.onQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
        if (event.key === "Enter") props.onFirst();
      }}
      className="mx-2 mb-1 rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]"
    />
  );
}

/** «Новая директива» — над поиском: хост спросит имя (решение 0028). */
export function NewDirectiveItem(props: { onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className="flex items-center gap-1.5 px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
    >
      <span className="flex size-4 items-center justify-center">{NewDirectiveIcon}</span>
      новая директива
    </button>
  );
}

export function DirectiveItems(props: { empty: string | undefined; children: ReactNode }) {
  return (
    <ul className="min-h-0 overflow-y-auto">
      {props.empty && <li className="px-3 py-0.5 opacity-60">{props.empty}</li>}
      {props.children}
    </ul>
  );
}

/**
 * Пункт — директива: имя открывает её файл, этапы запускают уже оттуда (решение 0045). Хост не
 * умеет открыть — имя просто подпись.
 */
export function DirectiveItem(props: {
  label: string;
  title: string;
  hint: string;
  hintClass: string;
  /** Этап идёт сейчас: лоадер перед подсказкой. */
  busy: boolean;
  onOpen?: (() => void) | undefined;
}) {
  return (
    <li className="px-3 py-0.5">
      <div className="flex items-baseline gap-2">
        {props.onOpen ? (
          <button
            type="button"
            title={props.title}
            onClick={props.onOpen}
            className="min-w-0 truncate text-left hover:underline"
          >
            {props.label}
          </button>
        ) : (
          <span title={props.title} className="min-w-0 truncate">
            {props.label}
          </span>
        )}
        <span
          className={`ml-auto flex shrink-0 items-center gap-1 self-center text-[10px] ${props.hintClass}`}
        >
          {props.busy && <Spinner />}
          {props.hint}
        </span>
      </div>
    </li>
  );
}
