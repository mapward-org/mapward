import { observer } from "mobx-react-lite";
import type * as Kit from "@mapward/display";
import type { LinkItem, Status, TreeItem } from "@mapward/display";
import { Markdown as Block, MarkdownLine } from "../../../lib/ui/markdown.tsx";
import { DEFAULT_TREE } from "../pure-model/tree-open.ts";
import { useKit } from "../ports.tsx";
import { EmptyList } from "../ui/display-parts.tsx";
import { StatusDot as Dot } from "../ui/status-dot.tsx";
import { Link as LinkRow, LinkList } from "./displays.tsx";
import { FileTree as Tree } from "./file-tree.tsx";

/**
 * Набор `@mapward/display` — решение 0037: те же кусочки, которыми нарисована карта, чтобы
 * компонент собирал из них, а не переписывал. Куда ведут ссылки и кто рисует экшоны, говорит
 * ячейка через контекст набора.
 */

const Link = observer(function Link(props: { item: LinkItem }) {
  const kit = useKit();
  return <LinkRow node={props.item} onOpen={kit.onOpen} onOpenTab={kit.onOpenTab} />;
});

const Markdown = observer(function Markdown(props: { text: string; inline?: boolean }) {
  const kit = useKit();
  return props.inline ? (
    <MarkdownLine text={props.text} onOpen={kit.onOpen} onOpenTab={kit.onOpenTab} />
  ) : (
    <Block text={props.text} onOpen={kit.onOpen} onOpenTab={kit.onOpenTab} />
  );
});

const StatusDot = observer(function StatusDot(props: {
  status?: Status;
  color?: string;
  hint?: string;
}) {
  return <Dot mark={props} />;
});

/** Кнопка экшона строки — у `List` и `FileTree` набора, как у готовых дисплеев (0038). */
const List = observer(function List(props: { items: LinkItem[]; empty?: string }) {
  const kit = useKit();
  return props.items.length === 0 ? (
    <EmptyList text={props.empty} />
  ) : (
    <LinkList
      items={props.items}
      onOpen={kit.onOpen}
      onOpenTab={kit.onOpenTab}
      renderAction={kit.renderRowAction}
    />
  );
});

/** `id` различает деревья одной метрики; одно дерево — `id` не нужен, оно «по умолчанию». */
const FileTree = observer(function FileTree(props: { items: TreeItem[]; id?: string }) {
  const kit = useKit();
  return (
    <Tree
      nodes={props.items}
      onOpen={kit.onOpen}
      onOpenTab={kit.onOpenTab}
      renderAction={kit.renderRowAction}
      open={kit.treeOpen?.(props.id ?? DEFAULT_TREE)}
    />
  );
});

/** Та же кнопка, что ставит в клетку раскладка, — решение 0038. */
const ActionButton = observer(function ActionButton(props: {
  action: string;
  inputs?: Record<string, unknown>;
  label?: string;
}) {
  const kit = useKit();
  return (
    <>
      {kit.renderActionButton?.(
        props.inputs === undefined
          ? { run: props.action }
          : { run: props.action, inputs: props.inputs },
        props.label,
      )}
    </>
  );
});

/**
 * Что получает `import … from "@mapward/display"`. Тип набора берётся из опубликованного пакета:
 * разойдутся — не соберётся клиент, а не сломается чужой компонент.
 */
export const DisplayKit = {
  Link,
  Markdown,
  StatusDot,
  List,
  FileTree,
  ActionButton,
} satisfies { [K in keyof typeof Kit]: (typeof Kit)[K] };
