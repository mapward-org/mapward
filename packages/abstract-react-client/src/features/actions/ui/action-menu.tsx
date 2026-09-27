import type { ReactNode } from "react";
import type { MapAction } from "@mapward/core";
import { ActionsIcon } from "../../../lib/ui/icons.tsx";
import { actionLabel } from "../pure-model/actions.ts";

/**
 * Все экшоны объекта в шапке — решение 0038: кнопка и список с поиском под ней. Что открыто и
 * что найдено, держит стор меню; здесь только то, как это выглядит.
 */
export function ActionMenuBox(props: {
  /** Элемент, клик мимо которого закрывает меню. */
  hold: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  // `flex`, как у меню терминалов: кнопка тянется до высоты соседей по шапке.
  return (
    <div ref={props.hold} className="relative flex">
      {props.children}
    </div>
  );
}

export function ActionMenuButton(props: { onToggle: (button: HTMLElement) => void }) {
  return (
    <button
      type="button"
      title="Экшоны"
      onClick={(event) => props.onToggle(event.currentTarget)}
      className="rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
    >
      {ActionsIcon}
    </button>
  );
}

export function ActionMenuPanel(props: { children: ReactNode }) {
  return (
    <div className="flex max-h-[60vh] w-64 flex-col rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
      {props.children}
    </div>
  );
}

/** Поиск стоит сразу; Enter запускает первый найденный, Escape закрывает меню. */
export function ActionSearch(props: {
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
      placeholder="найти экшон"
      onChange={(event) => props.onQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
        if (event.key === "Enter") props.onFirst();
      }}
      className="mx-2 mb-1 rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]"
    />
  );
}

export function ActionList(props: { empty: boolean; children: ReactNode }) {
  return (
    <ul className="min-h-0 overflow-y-auto">
      {props.empty && <li className="px-3 py-0.5 opacity-60">не нашлось</li>}
      {props.children}
    </ul>
  );
}

/**
 * Строка с меню экшонов: правый клик по ней открывает меню у курсора, «⋯» появляется при
 * наведении. Сама строка остаётся как была — клик по имени по-прежнему открывает ссылку.
 */
export function RowMenuFrame(props: {
  hold: (element: HTMLElement | null) => void;
  onContextMenu: (x: number, y: number) => void;
  button: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      ref={props.hold}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onContextMenu(event.clientX, event.clientY);
      }}
      className="group/menu flex min-w-0 items-center"
    >
      <div className="min-w-0 flex-1">{props.children}</div>
      {props.button}
    </div>
  );
}

export function RowMenuButton(props: { open: boolean; onToggle: (button: HTMLElement) => void }) {
  return (
    <button
      type="button"
      title="Экшоны строки"
      onClick={(event) => props.onToggle(event.currentTarget)}
      className={`shrink-0 rounded-sm px-1 leading-none hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100 ${
        props.open ? "opacity-100" : "opacity-0 group-hover/menu:opacity-60"
      }`}
    >
      ⋯
    </button>
  );
}

/** Строка назвала экшон, которого нет: пункт остаётся и говорит об этом, а не пропадает. */
export function MissingActionItem(props: { run: string }) {
  return (
    <li
      className="px-3 py-0.5 text-[var(--mw-errorForeground,#f85149)]"
      title="экшона с таким ключом или адресом нет"
    >
      нет экшона {props.run}
    </li>
  );
}

export function ActionItem(props: {
  action: MapAction;
  running: number;
  onSelect: (action: MapAction) => void;
  /** Откуда экшон — в шапке, где их много от прототипа; в меню строки это шум. */
  owner?: boolean;
}) {
  const { action, running } = props;
  return (
    <li>
      <button
        type="button"
        title={action.config.description ?? action.address}
        onClick={() => props.onSelect(action)}
        className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
      >
        <span className="truncate">{actionLabel(action)}</span>
        {running > 0 && <span className="shrink-0 animate-pulse text-[11px]">…{running}</span>}
        {/* Откуда экшон: от прототипа их много, и одноимённые различаются этим. */}
        {action.owner && props.owner !== false && (
          <span className="ml-auto shrink-0 text-[11px] opacity-60">
            {action.owner.replace("mapward://", "")}
          </span>
        )}
      </button>
    </li>
  );
}
