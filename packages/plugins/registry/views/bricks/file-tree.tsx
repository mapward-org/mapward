import { useState } from "react";
import { useViewState } from "@mapward/component";
import type { TreeItem } from "./types.ts";
import { isCard } from "./types.ts";
import { RowAction, WithRowMenu } from "./action-button.tsx";
import { ItemCard } from "./card.tsx";
import type { OnClick } from "./link.tsx";
import { Markdown } from "./markdown.tsx";
import { TAB_TITLE, fileIcon, gitColor, isObjectLink, openHow } from "./marks.ts";
import { GitMark, StatusDot } from "./status-dot.tsx";

/** Раскрытые папки — путями от корня, и как раскрыть или свернуть одну. */
type Folders = { isOpen: (path: string) => boolean; toggle: (path: string) => void };

/**
 * Что помнится о дереве: пути раскрытых папок или `"all"` — раскрыто всё. `"all"` отдаёт снимок
 * метрики с `expand: "all"`; свернуть папку из него — начать список заново.
 */
type Opened = string[] | "all";

const foldersOf = (open: Opened, save: (next: Opened) => void): Folders => ({
  isOpen: (path) => open === "all" || open.includes(path),
  toggle: (path) => save(open === "all" ? [] : toggled(open, path)),
});

/**
 * Папка узнаётся цепочкой имён от корня, а не номером строки: пересчёт добавляет файлы, и номера
 * съезжают. Без имени — номер.
 */
const folderPath = (parent: string, label: string | undefined, index: number) => {
  const name = label ?? `#${index}`;
  return parent === "" ? name : `${parent}/${name}`;
};

const isFolder = (item: TreeItem) => item.isDir ?? (item.children?.length ?? 0) > 0;

const toggled = (open: readonly string[], path: string) =>
  open.includes(path) ? open.filter((one) => one !== path) : [...open, path];

function Chevron(props: { open: boolean; visible: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 transition-transform ${props.open ? "rotate-90" : ""} ${props.visible ? "opacity-70" : "opacity-0"}`}
    >
      <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/**
 * Строка дерева. Папки складываются, файлы открываются — как в проводнике. Кнопка экшона —
 * рядом со строкой, а не в ней: строка — кнопка целиком, и клик по имени по-прежнему открывает.
 */
function Row(props: {
  item: TreeItem;
  path: string;
  depth: number;
  folders: Folders;
  onClick: OnClick<TreeItem>;
}) {
  const { item, path, depth, folders, onClick } = props;
  const folder = isFolder(item);
  const open = folders.isOpen(path);
  const label = item.label ?? "";
  // Табом открывают объект: папка складывается, файл открывается файлом.
  const tab = !folder && isObjectLink(item.link);
  const card = isCard(item);

  return (
    <li>
      {card ? (
        <div style={{ paddingLeft: `${depth * 10}px` }} className="mb-1.5">
          <ItemCard item={item} />
        </div>
      ) : (
        <WithRowMenu actions={item.actions}>
          <div className="flex items-center">
            <button
              type="button"
              onClick={(event) => {
                if (folder) return folders.toggle(path);
                if (item.link) onClick?.(item, openHow(item.link, event));
              }}
              {...(tab ? { title: TAB_TITLE } : {})}
              style={{ paddingLeft: `${depth * 10}px` }}
              className={`group/row flex min-w-0 flex-1 items-center gap-0.5 py-px text-left hover:bg-[var(--mw-list-hoverBackground)] ${
                tab ? "in-data-[tab-mod]:hover:cursor-pointer" : ""
              }`}
            >
              <Chevron open={open} visible={folder} />
              <span className={`codicon codicon-${fileIcon(label, folder)} shrink-0 opacity-80`} />
              <span
                className={`truncate ${tab ? "in-data-[tab-mod]:group-hover/row:underline" : ""}`}
                style={{ color: gitColor(item) }}
              >
                {item.label}
              </span>
              <GitMark git={item.git} folder={folder} />
              <StatusDot {...item} />
            </button>
            {item.action && <RowAction action={item.action} />}
          </div>
        </WithRowMenu>
      )}
      {item.description && (
        <div style={{ paddingLeft: `${depth * 10 + 18}px` }} className="text-[11px] opacity-70">
          <Markdown
            text={item.description}
            inline
            onOpen={onClick && ((link, how) => onClick({ link }, how))}
          />
        </div>
      )}
      {((folder && open) || card) && (
        <Rows
          items={item.children}
          parent={path}
          depth={depth + 1}
          folders={folders}
          onClick={onClick}
        />
      )}
    </li>
  );
}

function Rows(props: {
  items: TreeItem[] | undefined;
  parent: string;
  depth: number;
  folders: Folders;
  onClick: OnClick<TreeItem>;
}) {
  return (
    <ul>
      {(props.items ?? []).map((item, index) => {
        const path = folderPath(props.parent, item.label, index);
        return (
          <Row
            key={item.label ?? index}
            item={item}
            path={path}
            depth={props.depth}
            folders={props.folders}
            onClick={props.onClick}
          />
        );
      })}
    </ul>
  );
}

type TreeProps = { items: TreeItem[]; onClick?: OnClick<TreeItem> };

/** Раскрытие у человека, в хранилище редактора: переживает уход с объекта и перезагрузку окна. */
function SavedTree(props: TreeProps & { id: string }) {
  const [open, save] = useViewState<Opened>(`views:tree:${props.id}`, [], { expanded: "all" });
  const folders = foldersOf(open, save);
  return <Rows items={props.items} parent="" depth={0} folders={folders} onClick={props.onClick} />;
}

/** Раскрытие, пока дерево на экране. */
function LocalTree(props: TreeProps) {
  const [open, setOpen] = useState<Opened>([]);
  const folders = foldersOf(open, setOpen);
  return <Rows items={props.items} parent="" depth={0} folders={folders} onClick={props.onClick} />;
}

/**
 * Файловое дерево — как у вида `tree`: папки, буквы git, статусы, экшоны строк, узлы-карточки
 * объектов. `id` — под каким ключом помнить раскрытые папки у человека (свой на метрику и
 * дерево); без него дерево помнит их, пока оно на экране. `onClick` — клик по файлу.
 */
export function FileTree(props: TreeProps & { id?: string }) {
  return props.id === undefined ? (
    <LocalTree items={props.items} onClick={props.onClick} />
  ) : (
    <SavedTree id={props.id} items={props.items} onClick={props.onClick} />
  );
}
