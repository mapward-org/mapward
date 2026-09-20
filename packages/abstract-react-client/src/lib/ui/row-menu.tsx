import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

export type MenuAction = { key?: string; label: string; onSelect: () => void };

/** Клик мимо закрывает меню. Одно и то же у меню строки и у меню шапки. */
export function useDismiss(box: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [box, open, close]);
}

/**
 * Меню строки: кнопка с подписью и пункты под ней, вертикальным списком — решение 0028.
 * Та же форма, что у меню терминалов: пункт на строку, читается сверху вниз.
 *
 * Наведением не открывается: рука, идущая к следующей строке, не должна ничего открывать.
 * Меню лежит `fixed`, а не внутри строки: список директив прокручивается, и меню, лежащее
 * внутри него, обрезалось бы его краем. Прокрутка меню закрывает — иначе оно уедет от строки.
 */
export function RowMenu(props: {
  /** Слово или иконка — что понятнее в этом списке. Иконке нужен `title`. */
  label: ReactNode;
  title?: string;
  actions: MenuAction[];
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  // Место меряется после отрисовки кнопки и до показа меню: иначе первый кадр уедет в угол.
  useLayoutEffect(() => {
    if (!props.open) return;
    const rect = button.current?.getBoundingClientRect();
    if (rect) setAt({ top: rect.bottom + 2, right: window.innerWidth - rect.right });
  }, [props.open]);

  const { open, onOpen } = props;
  useEffect(() => {
    if (!open) return;
    const close = () => onOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, onOpen]);

  return (
    <>
      <button
        ref={button}
        type="button"
        {...(props.title === undefined ? {} : { title: props.title })}
        onClick={() => props.onOpen(!props.open)}
        className={`flex shrink-0 items-center rounded-sm px-1 text-[11px] hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100 ${
          props.open ? "opacity-100" : "opacity-60"
        }`}
      >
        {props.label}
      </button>

      {props.open && (
        <span
          style={{ top: at.top, right: at.right }}
          className="fixed z-50 flex max-h-[60vh] min-w-40 max-w-[22rem] flex-col overflow-y-auto rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg"
        >
          {props.actions.map((action) => (
            <button
              key={action.key ?? action.label}
              type="button"
              onClick={() => {
                props.onOpen(false);
                action.onSelect();
              }}
              className="w-full truncate px-3 py-0.5 text-left text-[11px] opacity-80 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
            >
              {action.label}
            </button>
          ))}
        </span>
      )}
    </>
  );
}
