import { type ReactNode, useEffect, useRef, useState } from "react";

/** A row of names is noise until you want it; behind a button it costs nothing. */
export function MenuButton(props: {
  title: string;
  icon: ReactNode;
  items: { key: string; label: string; hint?: string; hintClass?: string; onSelect: () => void }[];
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
        className="rounded-sm px-1 opacity-70 hover:bg-[var(--vscode-list-hoverBackground)] hover:opacity-100"
      >
        {props.icon}
      </button>

      {open && (
        <ul className="absolute right-0 z-50 min-w-56 rounded-sm border border-[var(--vscode-menu-border,#8884)] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] py-1 shadow-lg">
          {props.lead && (
            <li>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.lead?.onSelect();
                }}
                className="block w-full px-3 py-0.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
              >
                + {props.lead.label}
              </button>
            </li>
          )}
          {props.items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
              >
                <span className="truncate">{item.label}</span>
                {item.hint && (
                  <span className={`ml-auto shrink-0 ${item.hintClass ?? "opacity-60"}`}>
                    {item.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
