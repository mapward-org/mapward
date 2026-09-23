import { createContext, useContext } from "react";
import type * as Kit from "@mapward/display";
import type { LinkItem, Status, TreeItem } from "@mapward/display";
import { FileTree as Tree } from "./file-tree.tsx";
import { Link as LinkRow, LinkList } from "./displays.tsx";
import { Markdown as Block, MarkdownLine } from "./markdown.tsx";
import { StatusDot as Dot } from "./status-dot.tsx";

/**
 * Набор `@mapward/display` — решение 0037: те же кусочки, которыми нарисована карта, чтобы
 * компонент собирал из них, а не переписывал. Ссылки открываются так же, как везде на карте, —
 * куда, говорит ячейка через контекст.
 */
export type KitLinks = {
  onOpen: (link: string) => void;
  onOpenTab?: (link: string) => void;
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

function List(props: { items: LinkItem[]; empty?: string }) {
  const links = useLinks();
  if (props.items.length === 0)
    return <span className="opacity-60">{props.empty ?? "нет таких"}</span>;
  return <LinkList items={props.items} {...links} />;
}

function FileTree(props: { items: TreeItem[] }) {
  return <Tree nodes={props.items} {...useLinks()} />;
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
} satisfies { [K in keyof typeof Kit]: (typeof Kit)[K] };
