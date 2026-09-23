import { useRef, useState } from "react";
import type { MapAction } from "@mapward/core";
import { useDismiss } from "../../../../lib/ui/row-menu.tsx";
import { ActionsIcon } from "../../ui/icons.tsx";
import { actionLabel, matchActions } from "../pure-model/actions.ts";

/**
 * Все экшоны объекта в шапке — решение 0038: список с поиском внутри вида, а не окном
 * редактора. Поиск стоит сразу: от прототипа экшонов приезжает много, и нужен обычно один.
 * Запрос, как и у поиска директив, никуда не сохраняется.
 */
export function ActionMenu(props: {
  actions: MapAction[];
  running: (action: MapAction) => number;
  onRun: (action: MapAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  useDismiss(box, open, close);

  const found = matchActions(props.actions, query);

  return (
    // `flex`, как у меню терминалов: кнопка тянется до высоты соседей по шапке.
    <div ref={box} className="relative flex">
      <button
        type="button"
        title="Экшоны"
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
      >
        {ActionsIcon}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 flex max-h-[60vh] w-64 flex-col rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
          <input
            autoFocus
            type="search"
            value={query}
            placeholder="найти экшон"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
              // Enter запускает первый найденный: набрал имя — и запустил, не трогая мышь.
              const first = found[0];
              if (event.key === "Enter" && first) {
                close();
                props.onRun(first);
              }
            }}
            className="mx-2 mb-1 rounded-sm border border-[var(--mw-input-border,#8884)] bg-[var(--mw-input-background,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--mw-input-foreground,inherit)] outline-none focus:border-[var(--mw-focusBorder,#48f)]"
          />
          <ul className="min-h-0 overflow-y-auto">
            {found.length === 0 && <li className="px-3 py-0.5 opacity-60">не нашлось</li>}
            {found.map((action) => {
              const running = props.running(action);
              return (
                <li key={action.address}>
                  <button
                    type="button"
                    title={action.config.description ?? action.address}
                    onClick={() => {
                      close();
                      props.onRun(action);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
                  >
                    <span className="truncate">{actionLabel(action)}</span>
                    {running > 0 && (
                      <span className="shrink-0 animate-pulse text-[11px]">…{running}</span>
                    )}
                    {/* Откуда экшон: от прототипа их много, и одноимённые различаются этим. */}
                    {action.owner && (
                      <span className="ml-auto shrink-0 text-[11px] opacity-60">
                        {action.owner.replace("mapward://", "")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
