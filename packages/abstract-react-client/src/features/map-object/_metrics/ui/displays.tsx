import type { ReactNode } from "react";
import type {
  ActionRef,
  DisplayData,
  GitMark as Mark,
  LinkNode,
  MapRelation,
  StatusMark,
} from "../pure-model/display.ts";
import { gitColor, isObjectLink, placeholder } from "../pure-model/display.ts";
import type { TreeOpen } from "../pure-model/tree-open.ts";
import { tabHover } from "../../ui/tab-modifier.ts";
import { FileTree } from "./file-tree.tsx";
import { GitMark } from "./git-mark.tsx";
import { Markdown, MarkdownLine } from "./markdown.tsx";
import { StatusDot } from "./status-dot.tsx";

/**
 * Кнопка экшона строки — решение 0038. Рисует её `compose`: она знает объект и запуск, а слою
 * `ui` мост не положен. Строка только говорит, какой экшон и с какими значениями.
 */
export type RenderRowAction = (action: ActionRef) => ReactNode;

export function Link(props: {
  node: StatusMark & Mark & { label?: string; link?: string };
  onOpen: (link: string) => void;
  /**
   * Открыть объект отдельным табом ctrl + кликом — решение 0026. Иконки нет (0035): видно жест
   * подсветкой под ctrl, и ссылка не на объект её не получает.
   */
  onOpenTab?: (link: string) => void;
}) {
  const { node } = props;
  const text = node.label ?? node.link ?? "—";
  // Цвет git перебивает цвет ссылки: пометка про файл важнее того, что по нему можно кликнуть.
  const color = gitColor(node);
  const link = node.link;
  const tab = isObjectLink(link) ? props.onOpenTab : undefined;
  const body = link ? (
    <button
      type="button"
      onClick={(event) =>
        tab && (event.ctrlKey || event.metaKey) ? tab(link) : props.onOpen(link)
      }
      {...(tab === undefined ? {} : { title: "Ctrl + клик — открыть отдельным табом" })}
      style={color ? { color } : undefined}
      className={`truncate text-left text-[var(--mw-textLink-foreground)] ${
        tab ? tabHover.tabLink : tabHover.plainLink
      }`}
    >
      {text}
    </button>
  ) : (
    <span className="truncate" style={color ? { color } : undefined}>
      {text}
    </span>
  );

  return (
    <span className="flex items-center gap-1">
      <StatusDot mark={node} />
      {body}
      <GitMark mark={node} />
    </span>
  );
}

/** Список пунктов — дисплей `list`; его же берёт набор `@mapward/display` (решение 0037). */
export function LinkList(props: {
  items: LinkNode[];
  onOpen: (link: string) => void;
  onOpenTab?: (link: string) => void;
  /** Кнопка экшона строки — справа, отдельно от ссылки (решение 0038). */
  renderAction?: RenderRowAction;
}) {
  const tab = props.onOpenTab === undefined ? {} : { onOpenTab: props.onOpenTab };
  return (
    <ul>
      {props.items.map((item, index) => (
        <li key={`${item.label ?? index}`} className="mb-1">
          {item.action && props.renderAction ? (
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1">
                <Link node={item} onOpen={props.onOpen} {...tab} />
              </span>
              {props.renderAction(item.action)}
            </div>
          ) : (
            <Link node={item} onOpen={props.onOpen} {...tab} />
          )}
          {item.description && (
            <div className="pl-3 text-[11px] opacity-70">
              {/* Вторая строка — тоже разметка: проверке нужны жирный, код и ссылки (0027). */}
              <MarkdownLine text={item.description} onOpen={props.onOpen} {...tab} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Display(props: {
  data: DisplayData;
  /** Whether the metric has run at all: a cell that never ran is not a cell with bad data. */
  collected: boolean;
  /** Ответа ещё нет: значение не пришло с сервера или ещё поднимается с диска (решение 0041). */
  pending?: boolean;
  empty?: string;
  onOpen: (link: string) => void;
  /** Ссылка на объект открывается ещё и табом — решение 0026. Хост не умеет табы — нет её. */
  onOpenTab?: (link: string) => void;
  /**
   * Карту детей рисует подмодуль, а собирает его `compose`: слой `ui` чужие модули не тянет —
   * решение 0015.
   */
  renderMap: (map: { nodes: LinkNode[]; relations: MapRelation[] }) => ReactNode;
  /**
   * Свой компонент метрики — решение 0037. Собирает его сервер, а выполняет `compose`: слою
   * `ui` мост не положен.
   */
  renderComponent: (data: unknown) => ReactNode;
  /** Кнопка экшона строки списка и узла дерева — решение 0038. */
  renderAction?: RenderRowAction;
  /** Раскрытие папок дерева: хранит сетка, дисплей только передаёт. */
  treeOpen?: TreeOpen;
}) {
  const { data } = props;
  // Одним куском, чтобы не переписывать необязательное поле в каждой ветке ниже.
  const tab = props.onOpenTab === undefined ? {} : { onOpenTab: props.onOpenTab };
  const action = props.renderAction === undefined ? {} : { renderAction: props.renderAction };

  const note = placeholder(data, props.collected, props.empty, props.pending);
  if (note) return <span className="opacity-60">{note}</span>;

  switch (data.kind) {
    case "text":
      return <span>{data.text}</span>;
    // Тексты в значениях метрик лежали и раньше; этот дисплей их наконец показывает как текст,
    // а не как одну длинную строку — решение 0027.
    case "markdown":
      return <Markdown text={data.text} onOpen={props.onOpen} {...tab} />;
    case "link":
      return <Link node={data.node} onOpen={props.onOpen} {...tab} />;
    case "status":
      return (
        <span className="flex items-center gap-1">
          <StatusDot mark={{ status: data.ok ? "success" : "fail" }} />
          <span>{data.summary ?? (data.ok ? "ок" : "не ок")}</span>
        </span>
      );
    case "list":
      return <LinkList items={data.items} onOpen={props.onOpen} {...tab} {...action} />;
    case "tree":
      return (
        <FileTree
          nodes={data.children}
          onOpen={props.onOpen}
          {...tab}
          {...action}
          {...(props.treeOpen === undefined ? {} : { open: props.treeOpen })}
        />
      );
    case "map":
      return props.renderMap({ nodes: data.nodes, relations: data.relations });
    case "component":
      return props.renderComponent(data.data);
    default:
      return (
        <span className="text-[var(--mw-errorForeground)]" title={data.reason}>
          данные не той формы: {data.reason}
        </span>
      );
  }
}
