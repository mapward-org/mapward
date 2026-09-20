import type { ReactNode } from "react";

const RemoveIcon = (
  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" strokeLinecap="round" />
  </svg>
);

export type RowAction = { key?: string; label: string; onSelect: () => void };

/**
 * Строка списка: название, подсказка справа, ряд кнопок на наведении.
 *
 * Ряд лежит **под** строкой и поверх соседних: строка от наведения не растёт, и список
 * не дёргается — решение 0024. Первой кнопкой в ряду идёт «открыть», то же, что клик
 * по самой строке: ряд накрывает соседей, и рука, ушедшая вниз, не должна возвращаться.
 */
export function ListRow(props: {
  label: string;
  /** Подробность, которой не место в строке: висит тултипом. */
  title?: string;
  hint?: string;
  hintClass?: string;
  onSelect?: () => void;
  /** Ключ отдельно от подписи: у слоёв конфига подписи повторяются, файлы — нет. */
  actions?: RowAction[];
  /** Крестик справа, на наведении. Строка, которую убирать нечем, его не показывает. */
  onRemove?: () => void;
  children?: ReactNode;
}) {
  const actions = props.actions ?? [];
  const row =
    props.onSelect && actions.length > 0
      ? [{ key: "open", label: "открыть", onSelect: props.onSelect }, ...actions]
      : actions;

  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={props.onSelect}
        {...(props.title === undefined ? {} : { title: props.title })}
        className={`flex w-full items-center gap-2 py-0.5 pl-3 text-left hover:bg-[var(--mw-list-hoverBackground)] ${props.onRemove ? "pr-7" : "pr-3"}`}
      >
        <span className="truncate">{props.label}</span>
        {props.hint && (
          <span className={`ml-auto shrink-0 text-[11px] ${props.hintClass ?? "opacity-60"}`}>
            {props.hint}
          </span>
        )}
      </button>

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

      {row.length > 0 && (
        <span className="absolute top-full left-2 z-40 hidden w-max max-w-[22rem] flex-wrap gap-1 rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] px-1.5 py-1 shadow-lg group-hover/row:flex">
          {row.map((action) => (
            <button
              key={action.key ?? action.label}
              type="button"
              onClick={action.onSelect}
              className="rounded-sm px-1 text-[11px] opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
            >
              {action.label}
            </button>
          ))}
        </span>
      )}

      {props.children}
    </div>
  );
}
