import { type ReactNode, useEffect, useRef, useState } from "react";

/** A row of names is noise until you want it; behind a button it costs nothing. */
export function MenuButton(props: {
  title: string;
  icon: ReactNode;
  items: { key: string; label: string; onSelect: () => void }[];
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

  if (props.items.length === 0) return null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={props.title}
        onClick={() => setOpen(!open)}
        className="rounded-sm px-1 hover:bg-[var(--vscode-list-hoverBackground)]"
      >
        {props.icon}
      </button>

      {open && (
        <ul className="absolute right-0 z-10 min-w-40 rounded-sm border border-[var(--vscode-menu-border,transparent)] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] py-1 shadow-lg">
          {props.items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="block w-full truncate px-3 py-0.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
