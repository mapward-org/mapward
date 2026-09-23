import { action, makeObservable, observable } from "mobx";
import type { TreeNode } from "../pure-model/display.ts";
import { gitColor, isObjectLink } from "../pure-model/display.ts";
import { folderPath, type TreeOpen } from "../pure-model/tree-open.ts";

/** Узел дерева со всем, что про него показывается. */
export type TreeEntry = {
  node: TreeNode;
  key: string;
  /** Путь папки от корня — по нему раскрытие и запоминается. */
  path: string;
  depth: number;
  folder: boolean;
  label: string;
  color: string | undefined;
  /** Табом открывают объект: папка складывается, файл открывается файлом — решение 0026. */
  tab: boolean;
};

type Links = { onOpen: (link: string) => void; onOpenTab?: ((link: string) => void) | undefined };

/**
 * Дерево дисплея `tree` и `FileTree` набора. Раскрытие хранит сетка; без неё дерево помнит его
 * само, пока живо.
 */
export class TreeStore {
  private readonly here = observable.set<string>();

  constructor(private readonly open: TreeOpen | undefined) {
    makeObservable(this, { toggle: action });
  }

  /** Сохранённое ещё не пришло: закрытое дерево сейчас раскрылось бы через кадр и прыгнуло. */
  get ready(): boolean {
    return this.open === undefined || this.open.ready;
  }

  entries(nodes: TreeNode[] | undefined, links: Links, parent?: TreeEntry): TreeEntry[] {
    return (nodes ?? []).map((node, index) => {
      const folder = node.isDir ?? (node.children?.length ?? 0) > 0;
      return {
        node,
        key: `${node.label ?? index}`,
        path: folderPath(parent?.path ?? "", node.label, index),
        depth: parent === undefined ? 0 : parent.depth + 1,
        folder,
        label: node.label ?? "",
        color: gitColor(node),
        tab: !folder && isObjectLink(node.link) && links.onOpenTab !== undefined,
      };
    });
  }

  isOpen(entry: TreeEntry): boolean {
    return this.open ? this.open.isOpen(entry.path) : this.here.has(entry.path);
  }

  /** Раскрытая папка — её дети. */
  expanded(entry: TreeEntry): boolean {
    return entry.folder && this.isOpen(entry);
  }

  toggle(entry: TreeEntry): void {
    if (this.open) this.open.toggle(entry.path);
    else if (this.here.has(entry.path)) this.here.delete(entry.path);
    else this.here.add(entry.path);
  }

  click(entry: TreeEntry, mods: { ctrlKey: boolean; metaKey: boolean }, links: Links): void {
    if (entry.folder) return this.toggle(entry);
    const link = entry.node.link;
    if (!link) return;
    if (entry.tab && (mods.ctrlKey || mods.metaKey)) links.onOpenTab?.(link);
    else links.onOpen(link);
  }
}
