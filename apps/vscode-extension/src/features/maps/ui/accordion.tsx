import { type ReactNode, useState } from "react";

export type Section = { key: string; title: string; body: ReactNode };

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
    <div className="flex flex-col text-sm">
      {props.sections.map((section) => (
        <section key={section.key}>
          <button
            type="button"
            onClick={() => toggle(section.key)}
            className="flex w-full items-center gap-1 px-2 py-1 text-left uppercase opacity-80 hover:opacity-100"
          >
            <span className="inline-block w-3">{closed.has(section.key) ? "›" : "⌄"}</span>
            {section.title}
          </button>
          {!closed.has(section.key) && <div className="px-2 pb-2">{section.body}</div>}
        </section>
      ))}
    </div>
  );
}
