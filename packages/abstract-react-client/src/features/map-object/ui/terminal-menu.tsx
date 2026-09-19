import { useEffect, useRef, useState } from "react";

const TerminalIcon = (
  <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3.5" strokeLinecap="round" />
  </svg>
);

/** Terminals live as long as the editor keeps them: the list is what is open right now. */
export function TerminalMenu(props: {
  terminals: { name: string }[];
  onOpen: () => void;
  onFresh: () => void;
  onClose: (name: string) => void;
  onShow: (name: string) => void;
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

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title="Терминалы"
        // Nothing open yet — one click starts the conversation instead of showing an empty list.
        onClick={() => (props.terminals.length === 0 ? props.onOpen() : setOpen(!open))}
        className="rounded-sm px-1 opacity-70 hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
      >
        {TerminalIcon}
      </button>

      {open && (
        <ul className="absolute right-0 z-50 min-w-56 rounded-sm border border-[var(--mw-menu-border,#8884)] bg-[var(--mw-menu-background,var(--mw-editor-background))] py-1 shadow-lg">
          <li>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                props.onFresh();
              }}
              className="block w-full px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
            >
              + новый терминал
            </button>
          </li>
          {props.terminals.map((terminal) => (
            <li key={terminal.name} className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onShow(terminal.name);
                }}
                className="flex-1 truncate px-3 py-0.5 text-left hover:bg-[var(--mw-list-hoverBackground)]"
              >
                {terminal.name.replace("mapward: ", "")}
              </button>
              <button
                type="button"
                title="Закрыть"
                onClick={() => props.onClose(terminal.name)}
                className="px-2 opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
