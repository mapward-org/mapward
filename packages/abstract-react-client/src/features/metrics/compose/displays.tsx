import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";
import type {
  DisplayData,
  GitMark as Mark,
  LinkNode,
  MapRelation,
  StatusMark,
} from "../pure-model/display.ts";
import { placeholder } from "../pure-model/display.ts";
import type { TreeOpen } from "../pure-model/tree-open.ts";
import { Markdown, MarkdownLine } from "../../../lib/ui/markdown.tsx";
import type { RenderRowAction } from "../ports.tsx";
import { DisplayNote, PlainText, StatusLine, WrongShape } from "../ui/display-parts.tsx";
import { GitMark } from "../ui/git-mark.tsx";
import { LinkLine, LinkListFrame, LinkListItem, LinkText } from "../ui/link.tsx";
import { StatusDot } from "../ui/status-dot.tsx";
import { FileTree } from "./file-tree.tsx";

type OpenTab = ((link: string) => void) | undefined;

/** Ссылка дисплея: точка статуса, ссылка, пометка git. */
export const Link = observer(function Link(props: {
  node: StatusMark & Mark & { label?: string; link?: string };
  onOpen: (link: string) => void;
  onOpenTab?: OpenTab;
}) {
  return (
    <LinkLine>
      <StatusDot mark={props.node} />
      <LinkText node={props.node} onOpen={props.onOpen} onOpenTab={props.onOpenTab} />
      <GitMark mark={props.node} />
    </LinkLine>
  );
});

/** Список пунктов — дисплей `list`; его же берёт набор `@mapward/display` (решение 0037). */
export const LinkList = observer(function LinkList(props: {
  items: LinkNode[];
  onOpen: (link: string) => void;
  onOpenTab?: OpenTab;
  /** Кнопка экшона строки — справа, отдельно от ссылки (решение 0038). */
  renderAction?: RenderRowAction | undefined;
}) {
  return (
    <LinkListFrame>
      {props.items.map((item, index) => (
        <LinkListItem
          key={item.label ?? index}
          action={item.action && props.renderAction?.(item.action)}
          description={
            item.description && (
              <MarkdownLine
                text={item.description}
                onOpen={props.onOpen}
                onOpenTab={props.onOpenTab}
              />
            )
          }
        >
          <Link node={item} onOpen={props.onOpen} onOpenTab={props.onOpenTab} />
        </LinkListItem>
      ))}
    </LinkListFrame>
  );
});

/**
 * Дисплей метрики по виду данных. Тексты в значениях метрик лежали и раньше; `markdown`
 * показывает их текстом, а не одной длинной строкой — решение 0027.
 */
export const Display = observer(function Display(props: {
  data: DisplayData;
  /** Whether the metric has run at all: a cell that never ran is not a cell with bad data. */
  collected: boolean;
  /** Ответа ещё нет: значение не пришло с сервера или ещё поднимается с диска (решение 0041). */
  pending?: boolean | undefined;
  empty?: string | undefined;
  onOpen: (link: string) => void;
  /** Ссылка на объект открывается ещё и табом — решение 0026. Хост не умеет табы — нет её. */
  onOpenTab?: OpenTab;
  /**
   * Карту детей рисует её фича, а собирает `compose`: чужие модули фича не тянет — решение 0042.
   */
  renderMap: (map: { nodes: LinkNode[]; relations: MapRelation[] }) => ReactNode;
  /** Свой компонент метрики — решение 0037: собирает его сервер, выполняет `compose`. */
  renderComponent: (data: unknown) => ReactNode;
  /** Кнопка экшона строки списка и узла дерева — решение 0038. */
  renderAction?: RenderRowAction | undefined;
  /** Раскрытие папок дерева: хранит сетка, дисплей только передаёт. */
  treeOpen?: TreeOpen | undefined;
}) {
  const { data } = props;

  return (
    <DisplayNote note={placeholder(data, props.collected, props.empty, props.pending)}>
      {data.kind === "text" ? (
        <PlainText text={data.text} />
      ) : data.kind === "markdown" ? (
        <Markdown text={data.text} onOpen={props.onOpen} onOpenTab={props.onOpenTab} />
      ) : data.kind === "link" ? (
        <Link node={data.node} onOpen={props.onOpen} onOpenTab={props.onOpenTab} />
      ) : data.kind === "status" ? (
        <StatusLine
          ok={data.ok}
          summary={data.summary}
          dot={<StatusDot mark={{ status: data.ok ? "success" : "fail" }} />}
        />
      ) : data.kind === "list" ? (
        <LinkList
          items={data.items}
          onOpen={props.onOpen}
          onOpenTab={props.onOpenTab}
          renderAction={props.renderAction}
        />
      ) : data.kind === "tree" ? (
        <FileTree
          nodes={data.children}
          onOpen={props.onOpen}
          onOpenTab={props.onOpenTab}
          renderAction={props.renderAction}
          open={props.treeOpen}
        />
      ) : data.kind === "map" ? (
        props.renderMap({ nodes: data.nodes, relations: data.relations })
      ) : data.kind === "component" ? (
        props.renderComponent(data.data)
      ) : (
        <WrongShape reason={data.reason} />
      )}
    </DisplayNote>
  );
});
