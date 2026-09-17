import { useState } from "react";
import type { TreeNode } from "../pure-model/display.ts";
import { fileIcon } from "../pure-model/file-icon.ts";
import { StatusDot } from "./status-dot.tsx";

const Chevron = (props: { open: boolean; visible: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    className={`size-4 shrink-0 transition-transform ${props.open ? "rotate-90" : ""} ${props.visible ? "opacity-70" : "opacity-0"}`}
  >
    <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

/** Folders fold, files open — the shape people already know from the explorer. */
function Row(props: { node: TreeNode; depth: number; onOpen: (link: string) => void }) {
  const { node } = props;
  const folder = node.isDir ?? (node.children?.length ?? 0) > 0;
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        onClick={() => (folder ? setOpen(!open) : node.link && props.onOpen(node.link))}
        style={{ paddingLeft: `${props.depth * 10}px` }}
        className="flex w-full items-center gap-0.5 py-px text-left hover:bg-[var(--vscode-list-hoverBackground)]"
      >
        <Chevron open={open} visible={folder} />
        <span
          className={`codicon codicon-${fileIcon(node.label ?? "", folder)} shrink-0 opacity-80`}
        />
        <span className="truncate">{node.label}</span>
        <StatusDot mark={node} />
      </button>

      {node.description && (
        <div
          style={{ paddingLeft: `${props.depth * 10 + 18}px` }}
          className="text-[11px] opacity-70"
        >
          {node.description}
        </div>
      )}

      {folder && open && (
        <ul>
          {node.children?.map((child, index) => (
            <Row
              key={`${child.label ?? index}`}
              node={child}
              depth={props.depth + 1}
              onOpen={props.onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree(props: { nodes: TreeNode[]; onOpen: (link: string) => void }) {
  return (
    <ul>
      {props.nodes.map((node, index) => (
        <Row key={`${node.label ?? index}`} node={node} depth={0} onOpen={props.onOpen} />
      ))}
    </ul>
  );
}
