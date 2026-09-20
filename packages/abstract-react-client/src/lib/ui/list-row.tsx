import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { RowMenu, useDismiss, type MenuAction } from "./row-menu.tsx";

const RemoveIcon = (
  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" strokeLinecap="round" />
  </svg>
);

export type { MenuAction };

/**
 * Строка списка: название, подсказка справа, кнопка меню и крестик.
 *
 * Меню открывается кликом, а не наведением — решение 0028: ряд, появлявшийся под курсором,
 * ловил руку, идущую к следующей строке. Клик по самой строке делает то, ради чего строку
 * читают: `onSelect`, если он задан, иначе открывает то же меню.
 *
 * Крестик остаётся на наведении: он справа, и мышь едет к нему поперёк списка, а не вниз.
 */
export function ListRow(props: {
  label: string;
  /** Подробность, которой не место в строке: висит тултипом. */
  title?: string;
  hint?: string;
  hintClass?: string;
  onSelect?: () => void;
  /** Подпись кнопки одна на весь список: глаз читает её один раз, а не в каждой строке. */
  menu?: { label: ReactNode; title?: string; actions: MenuAction[] };
  /** Крестик справа, на наведении. Строка, которую убирать нечем, его не показывает. */
  onRemove?: () => void;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useDismiss(box, open, () => setOpen(false));

  const menu = props.menu;
  const select = props.onSelect ?? (menu ? () => setOpen(!open) : undefined);

  return (
    <div
      ref={box}
      className={`group/row relative flex items-center hover:bg-[var(--mw-list-hoverBackground)] ${
        props.onRemove ? "pr-7" : "pr-2"
      }`}
    >
      <button
        type="button"
        onClick={select}
        {...(props.title === undefined ? {} : { title: props.title })}
        className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-2 pl-3 text-left"
      >
        <span className="truncate">{props.label}</span>
        {props.hint && (
          <span className={`ml-auto shrink-0 text-[11px] ${props.hintClass ?? "opacity-60"}`}>
            {props.hint}
          </span>
        )}
      </button>

      {menu && menu.actions.length > 0 && (
        <RowMenu
          label={menu.label}
          {...(menu.title === undefined ? {} : { title: menu.title })}
          actions={menu.actions}
          open={open}
          onOpen={setOpen}
        />
      )}

      {/*
        Крестик поверх строки, а не в ней: строка — кнопка целиком, и вложить в неё вторую
        нельзя. На наведении — иначе список читался бы через ряд крестиков.
      */}
      {props.onRemove && (
        <button
          type="button"
          title="Удалить"
          onClick={props.onRemove}
          className="absolute top-1 right-2 hidden opacity-60 group-hover/row:block hover:opacity-100"
        >
          {RemoveIcon}
        </button>
      )}

      {props.children}
    </div>
  );
}
