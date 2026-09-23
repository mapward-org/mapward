import { observer } from "mobx-react-lite";
import type { TreeNode } from "../pure-model/display.ts";
import type { TreeOpen } from "../pure-model/tree-open.ts";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { MarkdownLine } from "../../../lib/ui/markdown.tsx";
import { TreeStore, type TreeEntry } from "../model/tree-store.ts";
import type { RenderRowAction } from "../ports.tsx";
import { GitMark } from "../ui/git-mark.tsx";
import { StatusDot } from "../ui/status-dot.tsx";
import {
  TreeChevron,
  TreeDescription,
  TreeIcon,
  TreeItem,
  TreeLabel,
  TreeLine,
  TreeList,
} from "../ui/tree-row.tsx";

type Links = {
  onOpen: (link: string) => void;
  /** Вниз по дереву жест едет так же: объект может лежать на любой глубине. */
  onOpenTab?: ((link: string) => void) | undefined;
  renderAction?: RenderRowAction | undefined;
};

const FileTreeRow = observer(function FileTreeRow(props: {
  tree: TreeStore;
  entry: TreeEntry;
  links: Links;
}) {
  const { tree, entry, links } = props;

  return (
    <TreeItem>
      <TreeLine
        depth={entry.depth}
        tab={entry.tab}
        onClick={(mods) => tree.click(entry, mods, links)}
        action={entry.node.action && links.renderAction?.(entry.node.action)}
      >
        <TreeChevron open={tree.isOpen(entry)} visible={entry.folder} />
        <TreeIcon label={entry.label} folder={entry.folder} />
        <TreeLabel label={entry.node.label} color={entry.color} tab={entry.tab} />
        <GitMark mark={entry.node} folder={entry.folder} />
        <StatusDot mark={entry.node} />
      </TreeLine>
      {entry.node.description && (
        <TreeDescription depth={entry.depth}>
          <MarkdownLine
            text={entry.node.description}
            onOpen={links.onOpen}
            onOpenTab={links.onOpenTab}
          />
        </TreeDescription>
      )}
      {tree.expanded(entry) && (
        <TreeList>
          {tree.entries(entry.node.children, links, entry).map((child) => (
            <FileTreeRow key={child.key} tree={tree} entry={child} links={links} />
          ))}
        </TreeList>
      )}
    </TreeItem>
  );
});

/** Дерево файлов — дисплей `tree` и `FileTree` набора (решение 0037). */
export const FileTree = observer(function FileTree(props: {
  nodes: TreeNode[];
  onOpen: (link: string) => void;
  onOpenTab?: ((link: string) => void) | undefined;
  renderAction?: RenderRowAction | undefined;
  /** Раскрытие, которое переживает уход с объекта и перезагрузку окна; без него — до ухода. */
  open?: TreeOpen | undefined;
}) {
  const tree = useLocalStore(() => new TreeStore(props.open), [props.open]);

  return tree.ready ? (
    <TreeList>
      {tree.entries(props.nodes, props).map((entry) => (
        <FileTreeRow key={entry.key} tree={tree} entry={entry} links={props} />
      ))}
    </TreeList>
  ) : null;
});
