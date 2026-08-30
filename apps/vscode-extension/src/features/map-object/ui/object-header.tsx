import type { ReactNode } from "react";

/** The prototype in front of the name turns inheritance into something you can read off. */
export function ObjectHeader(props: { name: string; prototypeName?: string; actions: ReactNode }) {
  return (
    <header className="relative z-50 flex shrink-0 items-center gap-2 px-2 pb-1">
      <h1 className="truncate font-medium">
        {props.prototypeName && <span className="opacity-60">{props.prototypeName}: </span>}
        {props.name}
      </h1>
      {/* No opacity here: it would be inherited by the menu that opens out of these buttons. */}
      <span className="ml-auto flex shrink-0 gap-1">{props.actions}</span>
    </header>
  );
}

export function HeaderButton(props: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className="rounded-sm px-1 opacity-70 hover:bg-[var(--vscode-list-hoverBackground)] hover:opacity-100"
    >
      {props.children}
    </button>
  );
}
