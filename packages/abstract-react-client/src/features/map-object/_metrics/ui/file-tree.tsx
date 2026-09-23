import { useState } from "react";
import type { TreeNode } from "../pure-model/display.ts";
import type { RenderRowAction } from "./displays.tsx";
import { gitColor, isObjectLink } from "../pure-model/display.ts";
import { folderPath, type TreeOpen } from "../pure-model/tree-open.ts";
import { fileIcon } from "../pure-model/file-icon.ts";
import { useIcon } from "../../../../ports/icons.tsx";
import { GitMark } from "./git-mark.tsx";
import { MarkdownLine } from "./markdown.tsx";
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
function Row(props: {
  node: TreeNode;
  depth: number;
  /** Путь папки от корня — по нему раскрытие и запоминается. */
  path: string;
  /** Раскрытие хранит сетка; без него строка помнит его сама, пока жива. */
  open?: TreeOpen;
  onOpen: (link: string) => void;
  onOpenTab?: (link: string) => void;
  renderAction?: RenderRowAction;
}) {
  const { node } = props;
  const folder = node.isDir ?? (node.children?.length ?? 0) > 0;
  const [openHere, setOpenHere] = useState(false);
  const open = props.open ? props.open.isOpen(props.path) : openHere;
  const toggle = () => (props.open ? props.open.toggle(props.path) : setOpenHere(!openHere));
  const icon = useIcon();
  // Табом открывают объект: папка складывается, файл открывается файлом — решение 0026. Иконки
  // у строки нет (0035): под ctrl имя объекта подчёркивается, как ссылка в редакторе.
  const tab = !folder && isObjectLink(node.link) ? props.onOpenTab : undefined;
  const link = node.link;
  // Вниз по дереву жест едет так же: объект может лежать на любой глубине.
  const tabProp = props.onOpenTab === undefined ? {} : { onOpenTab: props.onOpenTab };
  const actionProp = props.renderAction === undefined ? {} : { renderAction: props.renderAction };
  const openProp = props.open === undefined ? {} : { open: props.open };

  return (
    <li>
      <div className="flex items-center">
        <button
          type="button"
          onClick={(event) =>
            folder
              ? toggle()
              : link && (tab && (event.ctrlKey || event.metaKey) ? tab(link) : props.onOpen(link))
          }
          {...(tab === undefined ? {} : { title: "Ctrl + клик — открыть отдельным табом" })}
          style={{ paddingLeft: `${props.depth * 10}px` }}
          className={`group/row flex min-w-0 flex-1 items-center gap-0.5 py-px text-left hover:bg-[var(--mw-list-hoverBackground)] ${
            tab ? "in-data-[tab-mod]:hover:cursor-pointer" : ""
          }`}
        >
          <Chevron open={open} visible={folder} />
          {icon(fileIcon(node.label ?? "", folder), "shrink-0 opacity-80")}
          {/* Имя красится цветом git — так же, как в проводнике редактора (решение 0023). */}
          <span
            className={`truncate ${tab ? "in-data-[tab-mod]:group-hover/row:underline" : ""}`}
            style={{ color: gitColor(node) }}
          >
            {node.label}
          </span>
          <GitMark mark={node} folder={folder} />
          <StatusDot mark={node} />
        </button>
        {/*
          Кнопка экшона — рядом со строкой, а не в ней (решение 0038): строка — кнопка целиком,
          вложить в неё вторую нельзя, и клик по имени по-прежнему открывает файл.
        */}
        {node.action && props.renderAction?.(node.action)}
      </div>

      {node.description && (
        <div
          style={{ paddingLeft: `${props.depth * 10 + 18}px` }}
          className="text-[11px] opacity-70"
        >
          {/* Разметкой, как и в списке: подпись под узлом объясняет расхождение (0027). */}
          <MarkdownLine text={node.description} onOpen={props.onOpen} {...tabProp} />
        </div>
      )}

      {folder && open && (
        <ul>
          {node.children?.map((child, index) => (
            <Row
              key={`${child.label ?? index}`}
              node={child}
              depth={props.depth + 1}
              path={folderPath(props.path, child.label, index)}
              onOpen={props.onOpen}
              {...tabProp}
              {...actionProp}
              {...openProp}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree(props: {
  nodes: TreeNode[];
  onOpen: (link: string) => void;
  onOpenTab?: (link: string) => void;
  renderAction?: RenderRowAction;
  /** Раскрытие, которое переживает уход с объекта и перезагрузку окна; без него — до ухода. */
  open?: TreeOpen;
}) {
  const tabProp = props.onOpenTab === undefined ? {} : { onOpenTab: props.onOpenTab };
  const actionProp = props.renderAction === undefined ? {} : { renderAction: props.renderAction };
  const openProp = props.open === undefined ? {} : { open: props.open };
  // Сохранённое ещё не пришло: закрытое дерево сейчас раскрылось бы через кадр и прыгнуло.
  if (props.open && !props.open.ready) return null;
  return (
    <ul>
      {props.nodes.map((node, index) => (
        <Row
          key={`${node.label ?? index}`}
          node={node}
          depth={0}
          path={folderPath("", node.label, index)}
          onOpen={props.onOpen}
          {...tabProp}
          {...actionProp}
          {...openProp}
        />
      ))}
    </ul>
  );
}
