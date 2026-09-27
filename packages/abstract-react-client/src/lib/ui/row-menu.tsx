import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";
import { Anchor } from "../mobx/popup.ts";
import { useLocalStore } from "../mobx/use-local-store.ts";
import { Spinner } from "./spinner.tsx";

/** `busy` — пункт идёт сейчас: лоадер рядом с подписью. */
export type MenuAction = { key?: string; label: string; busy?: boolean; onSelect: () => void };

/**
 * Меню строки: кнопка с подписью и пункты под ней, вертикальным списком — решение 0028.
 * Та же форма, что у меню терминалов: пункт на строку, читается сверху вниз.
 *
 * Наведением не открывается: рука, идущая к следующей строке, не должна ничего открывать.
 * Меню лежит `fixed`, а не внутри строки: список директив прокручивается, и меню, лежащее
 * внутри него, обрезалось бы его краем. Место меряется по кнопке в момент открытия, а закрывает
 * меню от прокрутки тот, кто держит его открытым.
 */
export const RowMenu = observer(function RowMenu(props: {
  /** Слово или иконка — что понятнее в этом списке. Иконке нужен `title`. */
  label: ReactNode;
  title?: string;
  actions: MenuAction[];
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const anchor = useLocalStore(() => new Anchor());

  return (
    <>
      <button
        type="button"
        {...(props.title === undefined ? {} : { title: props.title })}
        onClick={(event) => {
          anchor.measure(event.currentTarget);
          props.onOpen(!props.open);
        }}
        className={`flex shrink-0 items-center rounded-sm px-1 text-[11px] hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100 ${
          props.open ? "opacity-100" : "opacity-60"
        }`}
      >
        {props.label}
      </button>

      {props.open && (
        <span
          style={{ top: anchor.at.top, right: anchor.at.right }}
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
              className="flex w-full items-center gap-1.5 px-3 py-0.5 text-left text-[11px] opacity-80 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
            >
              <span className="truncate">{action.label}</span>
              {action.busy && <Spinner />}
            </button>
          ))}
        </span>
      )}
    </>
  );
});
