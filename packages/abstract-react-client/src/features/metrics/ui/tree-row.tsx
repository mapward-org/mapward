import type { ReactNode } from "react";
import { useIcon } from "../../../ports/icons.tsx";
import { fileIcon } from "../pure-model/file-icon.ts";

export function TreeList(props: { children: ReactNode }) {
  return <ul>{props.children}</ul>;
}

/** Узел дерева: строка, подпись под ней, раскрытые дети — их кладёт `compose`. */
export function TreeItem(props: { children: ReactNode }) {
  return <li>{props.children}</li>;
}

/**
 * Folders fold, files open — the shape people already know from the explorer. Кнопка экшона —
 * рядом со строкой, а не в ней (решение 0038): строка — кнопка целиком, вложить в неё вторую
 * нельзя, и клик по имени по-прежнему открывает файл.
 */
export function TreeLine(props: {
  depth: number;
  /** Табом открывают объект: под ctrl имя подчёркивается, как ссылка в редакторе (0026, 0035). */
  tab: boolean;
  onClick: (mods: { ctrlKey: boolean; metaKey: boolean }) => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={(event) => props.onClick(event)}
        {...(props.tab ? { title: "Ctrl + клик — открыть отдельным табом" } : {})}
        style={{ paddingLeft: `${props.depth * 10}px` }}
        className={`group/row flex min-w-0 flex-1 items-center gap-0.5 py-px text-left hover:bg-[var(--mw-list-hoverBackground)] ${
          props.tab ? "in-data-[tab-mod]:hover:cursor-pointer" : ""
        }`}
      >
        {props.children}
      </button>
      {props.action}
    </div>
  );
}

export function TreeChevron(props: { open: boolean; visible: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 transition-transform ${props.open ? "rotate-90" : ""} ${props.visible ? "opacity-70" : "opacity-0"}`}
    >
      <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function TreeIcon(props: { label: string; folder: boolean }) {
  const icon = useIcon();
  return <>{icon(fileIcon(props.label, props.folder), "shrink-0 opacity-80")}</>;
}

/** Имя красится цветом git — так же, как в проводнике редактора (решение 0023). */
export function TreeLabel(props: {
  label?: string | undefined;
  color?: string | undefined;
  tab: boolean;
}) {
  return (
    <span
      className={`truncate ${props.tab ? "in-data-[tab-mod]:group-hover/row:underline" : ""}`}
      style={{ color: props.color }}
    >
      {props.label}
    </span>
  );
}

/** Подпись под узлом — разметкой, как и в списке: объясняет расхождение (0027). */
export function TreeDescription(props: { depth: number; children: ReactNode }) {
  return (
    <div style={{ paddingLeft: `${props.depth * 10 + 18}px` }} className="text-[11px] opacity-70">
      {props.children}
    </div>
  );
}

/** Узел дерева карточкой объекта: отступ по глубине тот же, что у строки. */
export function TreeCard(props: { depth: number; children: ReactNode }) {
  return (
    <div style={{ paddingLeft: `${props.depth * 10}px` }} className="mb-1.5">
      {props.children}
    </div>
  );
}
