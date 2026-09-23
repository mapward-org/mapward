import { createContext, useContext, type ReactNode } from "react";
import type * as Kit from "@mapward/display";
import type { ActionRef, LinkItem, Status, TreeItem } from "@mapward/display";
import { DEFAULT_TREE, type TreeOpen } from "../pure-model/tree-open.ts";
import { FileTree as Tree } from "./file-tree.tsx";
import { Link as LinkRow, LinkList, type RenderRowAction } from "./displays.tsx";
import { Markdown as Block, MarkdownLine } from "./markdown.tsx";
import { StatusDot as Dot } from "./status-dot.tsx";

/**
 * Набор `@mapward/display` — решение 0037: те же кусочки, которыми нарисована карта, чтобы
 * компонент собирал из них, а не переписывал. Ссылки открываются так же, как везде на карте, —
 * куда, говорит ячейка через контекст. Экшоны едут тем же контекстом (0038): кнопку строки и
 * кнопку экшона рисует та же сетка, что и у готовых дисплеев.
 */
export type KitLinks = {
  onOpen: (link: string) => void;
  onOpenTab?: (link: string) => void;
  renderRowAction?: RenderRowAction;
  renderActionButton?: (action: ActionRef, label?: string) => ReactNode;
  /** Раскрытие дерева по его `id`: запоминает сетка, автору компонента передавать нечего. */
  treeOpen?: (id: string) => TreeOpen;
};

const KitContext = createContext<KitLinks>({ onOpen: () => {} });

export const KitProvider = KitContext.Provider;

const useLinks = () => {
  const links = useContext(KitContext);
  return links.onOpenTab === undefined
    ? { onOpen: links.onOpen }
    : { onOpen: links.onOpen, onOpenTab: links.onOpenTab };
};

function Link(props: { item: LinkItem }) {
  return <LinkRow node={props.item} {...useLinks()} />;
}

function Markdown(props: { text: string; inline?: boolean }) {
  const links = useLinks();
  return props.inline ? (
    <MarkdownLine text={props.text} {...links} />
  ) : (
    <Block text={props.text} {...links} />
  );
}

function StatusDot(props: { status?: Status; color?: string; hint?: string }) {
  return <Dot mark={props} />;
}

/** Кнопка экшона строки — у `List` и `FileTree` набора, как у готовых дисплеев (0038). */
const useRowAction = () => {
  const render = useContext(KitContext).renderRowAction;
  return render === undefined ? {} : { renderAction: render };
};

function List(props: { items: LinkItem[]; empty?: string }) {
  const links = useLinks();
  const action = useRowAction();
  if (props.items.length === 0)
    return <span className="opacity-60">{props.empty ?? "нет таких"}</span>;
  return <LinkList items={props.items} {...links} {...action} />;
}

/** `id` различает деревья одной метрики; одно дерево — `id` не нужен, оно «по умолчанию». */
function FileTree(props: { items: TreeItem[]; id?: string }) {
  const open = useContext(KitContext).treeOpen?.(props.id ?? DEFAULT_TREE);
  return (
    <Tree
      nodes={props.items}
      {...useLinks()}
      {...useRowAction()}
      {...(open === undefined ? {} : { open })}
    />
  );
}

/** Та же кнопка, что ставит в клетку раскладка, — решение 0038. */
function ActionButton(props: { action: string; inputs?: Record<string, unknown>; label?: string }) {
  const render = useContext(KitContext).renderActionButton;
  const ref: ActionRef =
    props.inputs === undefined
      ? { run: props.action }
      : { run: props.action, inputs: props.inputs };
  return <>{render?.(ref, props.label)}</>;
}

/**
 * Что получает `import … from "@mapward/display"`. Тип набора берётся из опубликованного пакета:
 * разойдутся — не соберётся клиент, а не сломается чужой компонент.
 */
export const displayKit = {
  Link,
  Markdown,
  StatusDot,
  List,
  FileTree,
  ActionButton,
} satisfies { [K in keyof typeof Kit]: (typeof Kit)[K] };
