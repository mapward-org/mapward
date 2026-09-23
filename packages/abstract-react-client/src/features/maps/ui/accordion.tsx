import type { ReactNode } from "react";
import { FoldChevron } from "../../../lib/ui/fold-chevron.tsx";

/** Sections fold the way workspace roots do in the explorer — a habit that already exists. */
export function Accordion(props: { children: ReactNode }) {
  return <div className="flex h-full flex-col">{props.children}</div>;
}

/**
 * A folded section is hidden, not unmounted: the map inside keeps its open nodes, selection and
 * scroll. A section never opened is not mounted at all — it loads on first unfolding. Which
 * sections are open and mounted comes from outside: keeping it is the caller's business.
 */
export function AccordionSection(props: {
  title: string;
  open: boolean;
  mounted: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={props.open ? "flex min-h-0 flex-1 flex-col" : ""}>
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center gap-px py-[3px] pr-2 text-left text-[11px] font-semibold tracking-wide uppercase hover:bg-[var(--mw-list-hoverBackground)]"
      >
        <FoldChevron open={props.open} />
        <span className="truncate">{props.title}</span>
      </button>
      {props.mounted && (
        <div hidden={!props.open} className="min-h-0 flex-1 overflow-auto pb-1 pl-5">
          {props.children}
        </div>
      )}
    </section>
  );
}

/** Пока хост не сказал, что с картами, — строка о том, что ищем. */
export function Searching() {
  return <p className="p-3 text-[var(--mw-descriptionForeground)]">Ищем карты…</p>;
}
