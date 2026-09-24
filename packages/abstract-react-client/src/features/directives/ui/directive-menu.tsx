import type { ReactNode } from "react";
import { DirectivesIcon } from "../../../lib/ui/icons.tsx";

/**
 * Директивы объекта кнопкой с поиском — в шапке карточки. Выглядит как меню экшонов рядом:
 * две кнопки одной шапки, и различаться им незачем, кроме иконки.
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

export function DirectiveMenuButton(props: { onToggle: (button: HTMLElement) => void }) {
  return (
    <button
      type="button"
      title="Директивы"
      onClick={(event) => props.onToggle(event.currentTarget)}
      className="rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
    >
      {DirectivesIcon}
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

/** Поиск стоит сразу; Enter запускает первый найденный этап, Escape закрывает меню. */
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

export function StageList(props: { empty: string | undefined; children: ReactNode }) {
  return (
    <ul className="min-h-0 overflow-y-auto">
      {props.empty && <li className="px-3 py-0.5 opacity-60">{props.empty}</li>}
      {props.children}
    </ul>
  );
}

/** Пункт «директива · этап»; многоточие — этот этап идёт сейчас. */
export function StageItem(props: {
  label: string;
  title: string;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        title={props.title}
        onClick={props.onSelect}
        className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
      >
        <span className="truncate">{props.label}</span>
        {props.busy && <span className="shrink-0 animate-pulse text-[11px]">…</span>}
      </button>
    </li>
  );
}
