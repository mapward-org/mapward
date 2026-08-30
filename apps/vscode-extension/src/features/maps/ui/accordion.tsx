import { type ReactNode, useState } from "react";

export type Section = { key: string; title: string; body: ReactNode };

/** One glyph rotated, not two different ones: the row keeps its geometry when it folds. */
function Chevron(props: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-4 shrink-0 transition-transform duration-100 ${props.open ? "rotate-90" : ""}`}
    >
      <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Sections fold the way workspace roots do in the explorer — a habit that already exists. */
export function Accordion(props: { sections: Section[] }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string) =>
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      {props.sections.map((section) => {
        const open = !closed.has(section.key);
        return (
          <section key={section.key} className={open ? "flex min-h-0 flex-1 flex-col" : ""}>
            <button
              type="button"
              onClick={() => toggle(section.key)}
              className="flex w-full items-center gap-px py-[3px] pr-2 text-left text-[11px] font-semibold tracking-wide uppercase hover:bg-[var(--vscode-list-hoverBackground)]"
            >
              <Chevron open={open} />
              <span className="truncate">{section.title}</span>
            </button>
            {open && <div className="min-h-0 flex-1 overflow-auto pb-1 pl-5">{section.body}</div>}
          </section>
        );
      })}
    </div>
  );
}
