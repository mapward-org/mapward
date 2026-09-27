import type { ReactNode } from "react";

/**
 * The prototype in front of the name turns inheritance into something you can read off. `group`
 * lets the tab button next to the name show up only while the pointer is over this row
 * (decision 0045).
 */
export function ObjectHeader(props: {
  name: string;
  prototypeName?: string;
  /** Right after the name — the tab button: it is about this very object. */
  aside?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header className="group relative z-50 flex shrink-0 items-center gap-1 px-2 py-1">
      <h1 className="truncate font-medium">
        {props.prototypeName && <span className="opacity-60">{props.prototypeName}: </span>}
        {props.name}
      </h1>
      {props.aside}
      {/* No opacity here: it would be inherited by the menu that opens out of these buttons. */}
      <span className="ml-auto flex shrink-0 gap-1 pl-1">{props.actions}</span>
    </header>
  );
}

/**
 * "Open in a separate tab" sits right after the name and is visible only on hover over the
 * header row (decision 0045). It keeps its place while hidden, so nothing shifts when it shows.
 */
export function HeaderTabButton(props: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className="invisible shrink-0 rounded-sm px-1 opacity-70 group-hover:visible hover:bg-[var(--mw-list-hoverBackground)] hover:opacity-100"
    >
      {props.children}
    </button>
  );
}
