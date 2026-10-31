import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAction, useFloatingLayer } from "@mapward/component";
import type { ActionRef } from "./types.ts";

/**
 * Кнопки экшонов — решение 0038, обёртки над `useAction`: запуск идёт тем же путём, что из шапки
 * объекта (форма, вопрос, история прогонов). Экшона нет — кнопка остаётся на месте и говорит об
 * этом, а не пропадает молча.
 */

const MENU_WIDTH = 256;

const ERROR = "text-[var(--mw-errorForeground,#f85149)]";

/** Сколько прогонов идёт: число, а не просто «идёт» — прогоны одного экшона параллельны. */
function Running(props: { count: number }) {
  if (props.count === 0) return null;
  return (
    <span className="shrink-0 animate-pulse text-[11px]" title={`идёт прогонов: ${props.count}`}>
      {props.count > 1 ? `…${props.count}` : "…"}
    </span>
  );
}

/**
 * Кнопка экшона: её ставит в раскладку или в компонент сам автор. `action` — ключ экшона объекта
 * или адрес `mapward://…/_actions/<ключ>`, `inputs` — значения формы, `label` — своя подпись.
 */
export function ActionButton(props: {
  action: string;
  inputs?: Record<string, unknown>;
  label?: string;
}) {
  const action = useAction(props.action, props.inputs);
  if (action.missing)
    return <span className={`text-[11px] ${ERROR}`}>нет экшона {props.action}</span>;
  return (
    <button
      type="button"
      onClick={() => action.run()}
      title={action.description ?? action.label}
      className="flex min-w-0 items-center gap-1 self-start rounded-sm border border-[var(--mw-menu-border,#8884)] px-2 py-0.5 hover:bg-[var(--mw-list-hoverBackground)]"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4 shrink-0 opacity-80"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
        <path d="M9 3 4.5 9.5H8L7 13l4.5-6.5H8z" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{props.label ?? action.label}</span>
      <Running count={action.running} />
    </button>
  );
}

/**
 * Кнопка экшона строки списка или узла дерева — справа, отдельно от строки: клик по самой строке
 * по-прежнему ведёт по ссылке. Экшона нет — ошибка этой строки, а не всей метрики.
 */
export function RowAction(props: { action: ActionRef }) {
  const action = useAction(props.action.run, props.action.inputs);
  if (action.missing) {
    return (
      <span
        className={`shrink-0 px-1 text-[11px] ${ERROR}`}
        title={`нет экшона ${props.action.run}`}
      >
        !
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center">
      <Running count={action.running} />
      <button
        type="button"
        onClick={() => action.run()}
        title={`Запустить: ${action.label}`}
        className="shrink-0 rounded-sm px-1 opacity-60 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
          <path d="M5.5 3.5 12 8l-6.5 4.5z" />
        </svg>
      </button>
    </span>
  );
}

function MenuItem(props: { action: ActionRef; onDone: () => void }) {
  const action = useAction(props.action.run, props.action.inputs);
  if (action.missing) {
    return (
      <li className={`px-3 py-0.5 ${ERROR}`} title="экшона с таким ключом или адресом нет">
        нет экшона {props.action.run}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        title={action.description ?? action.label}
        onClick={() => {
          props.onDone();
          action.run();
        }}
        className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
      >
        <span className="truncate">{action.label}</span>
        <Running count={action.running} />
      </button>
    </li>
  );
}

/**
 * Меню строки — экшоны из `actions` пункта: кнопкой «⋯» при наведении и правым кликом по строке.
 * Сама строка остаётся как была. Меню — порталом поверх страницы: клетка метрики с прокруткой
 * обрезала бы его. Портал — в слой окон компонента, а не в `body`: классы компонента действуют
 * только там и в его клетке (решение 0048).
 */
export function RowMenu(props: { actions: ActionRef[]; children: ReactNode }) {
  // Где встаёт левый верхний угол меню: у курсора или под «⋯», правым краем к ней.
  const [at, setAt] = useState<{ left: number; top: number } | undefined>(undefined);
  const row = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const floating = useFloatingLayer();

  // Клик мимо меню и Escape закрывают его.
  useEffect(() => {
    if (!at) return;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !row.current?.contains(target)) setAt(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAt(undefined);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [at]);

  return (
    <div
      ref={row}
      onContextMenu={(event) => {
        event.preventDefault();
        setAt({ left: event.clientX, top: event.clientY });
      }}
      className="group/menu flex min-w-0 items-center"
    >
      <div className="min-w-0 flex-1">{props.children}</div>
      <button
        type="button"
        title="Экшоны строки"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setAt(at ? undefined : { left: box.right - MENU_WIDTH, top: box.bottom });
        }}
        className={`shrink-0 rounded-sm px-1 leading-none hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100 ${
          at ? "opacity-100" : "opacity-0 group-hover/menu:opacity-60"
        }`}
      >
        ⋯
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            style={{ left: Math.max(0, at.left), top: at.top, width: MENU_WIDTH }}
            className="fixed z-50 flex max-h-[60vh] flex-col rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg"
          >
            <ul className="min-h-0 overflow-y-auto">
              {props.actions.map((action, index) => (
                <MenuItem
                  key={`${index}:${action.run}`}
                  action={action}
                  onDone={() => setAt(undefined)}
                />
              ))}
            </ul>
          </div>,
          floating(),
        )}
    </div>
  );
}

/** Строка с меню экшонов, если она их назвала; иначе строка как есть. */
export function WithRowMenu(props: { actions?: ActionRef[] | undefined; children: ReactNode }) {
  return props.actions?.length ? (
    <RowMenu actions={props.actions}>{props.children}</RowMenu>
  ) : (
    <>{props.children}</>
  );
}
