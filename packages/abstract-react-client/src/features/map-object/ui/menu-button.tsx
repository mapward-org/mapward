import { type ReactNode, useEffect, useRef, useState } from "react";

/** A row of names is noise until you want it; behind a button it costs nothing. */
export function MenuButton(props: {
  title: string;
  icon: ReactNode;
  items: {
    key: string;
    label: string;
    /** Подробность, которой не место в строке: висит тултипом, как у кнопок шапки. */
    title?: string;
    hint?: string;
    hintClass?: string;
    onSelect: () => void;
    runs?: { label: string; onSelect: () => void }[];
  }[];
  lead?: { label: string; onSelect: () => void };
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (props.items.length === 0 && !props.lead) return null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={props.title}
        onClick={() => setOpen(!open)}
        className="rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
      >
        {props.icon}
      </button>

      {open && (
        <ul className="absolute right-0 z-50 min-w-56 rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
          {props.lead && (
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.lead?.onSelect();
                }}
                className="block w-full px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
              >
                + {props.lead.label}
              </button>
            </li>
          )}
          {props.items.map((item) => (
            <li key={item.key} className="group/item">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                {...(item.title === undefined ? {} : { title: item.title })}
                className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
              >
                <span className="truncate">{item.label}</span>
                {item.hint && (
                  <span className={`ml-auto shrink-0 ${item.hintClass ?? "opacity-60"}`}>
                    {item.hint}
                  </span>
                )}
              </button>
              {item.runs && (
                <span className="hidden gap-2 px-3 pb-1 opacity-70 group-hover/item:flex">
                  {item.runs.map((run) => (
                    <button
                      key={run.label}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        run.onSelect();
                      }}
                      className="rounded-sm px-1 text-[11px] hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
                    >
                      {run.label}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
