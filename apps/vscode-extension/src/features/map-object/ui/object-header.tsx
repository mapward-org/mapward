import type { ReactNode } from "react";

/** The prototype in front of the name turns inheritance into something you can read off. */
export function ObjectHeader(props: { name: string; prototypeName?: string; actions: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-2 pb-1">
      <h1 className="truncate font-medium">
        {props.prototypeName && <span className="opacity-60">{props.prototypeName}: </span>}
        {props.name}
      </h1>
      <span className="ml-auto flex shrink-0 gap-1 opacity-70">{props.actions}</span>
    </header>
  );
}

export function HeaderButton(props: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className="rounded-sm px-1 hover:bg-[var(--vscode-list-hoverBackground)]"
    >
      {props.children}
    </button>
  );
}
