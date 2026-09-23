import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";
import { Toggle } from "../mobx/popup.ts";
import { useLocalStore } from "../mobx/use-local-store.ts";

const Chevron = (props: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    className={`size-3 shrink-0 transition-transform ${props.open ? "rotate-90" : ""}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Раздел с заголовком, который сворачивается — решение 0028.
 *
 * Состояние держится здесь и никуда не сохраняется: свёрнутость — состояние интерфейса, как
 * и сам мета-экран (0024). Уход на другой объект перемонтирует разделы и раскрывает их снова.
 *
 * Кнопки заголовка (`actions`) лежат рядом с названием, а не внутри кнопки сворачивания:
 * вложить кнопку в кнопку нельзя, и клик по плюсику не должен закрывать раздел.
 */
export const Section = observer(function Section(props: {
  icon?: ReactNode;
  title: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const toggle = useLocalStore(() => new Toggle(props.defaultOpen ?? true));
  const open = toggle.open;

  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 pr-2 pl-1">
        <button
          type="button"
          onClick={() => toggle.flip()}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-[11px] uppercase opacity-60 hover:opacity-100"
        >
          <Chevron open={open} />
          {props.icon && <span className="shrink-0 opacity-80">{props.icon}</span>}
          <span className="truncate">{props.title}</span>
        </button>
        {props.actions}
      </div>
      {open && props.children}
    </section>
  );
});

/** Кнопка в заголовке раздела: тот же размер, что у кнопок шапки объекта. */
export function SectionButton(props: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className="shrink-0 rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
    >
      {props.children}
    </button>
  );
}
