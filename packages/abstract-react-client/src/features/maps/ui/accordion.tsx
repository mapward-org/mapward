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

/**
 * Sections fold the way workspace roots do in the explorer — a habit that already exists.
 *
 * A folded section is hidden, not unmounted: the map inside keeps its open nodes, selection and
 * scroll. A section never opened is not mounted at all — it loads on first unfold. Which
 * sections are closed comes from outside: keeping it is the caller's business.
 */
export function Accordion(props: {
  sections: Section[];
  closed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  // Запоминается во время рендера, а не эффектом: иначе развёрнутая секция первый кадр была бы
  // пустой.
  const unseen = props.sections.filter((s) => !props.closed.has(s.key) && !opened.has(s.key));
  if (unseen.length > 0) setOpened(new Set([...opened, ...unseen.map((s) => s.key)]));

  return (
    <div className="flex h-full flex-col">
      {props.sections.map((section) => {
        const open = !props.closed.has(section.key);
        const mounted = open || opened.has(section.key);
        return (
          <section key={section.key} className={open ? "flex min-h-0 flex-1 flex-col" : ""}>
            <button
              type="button"
              onClick={() => props.onToggle(section.key)}
              className="flex w-full items-center gap-px py-[3px] pr-2 text-left text-[11px] font-semibold tracking-wide uppercase hover:bg-[var(--mw-list-hoverBackground)]"
            >
              <Chevron open={open} />
              <span className="truncate">{section.title}</span>
            </button>
            {mounted && (
              <div hidden={!open} className="min-h-0 flex-1 overflow-auto pb-1 pl-5">
                {section.body}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
