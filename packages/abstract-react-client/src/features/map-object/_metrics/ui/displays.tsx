import type { ReactNode } from "react";
import type {
  DisplayData,
  GitMark as Mark,
  LinkNode,
  MapRelation,
  StatusMark,
} from "../pure-model/display.ts";
import { gitColor, isObjectLink, placeholder } from "../pure-model/display.ts";
import { TabIcon } from "../../ui/icons.tsx";
import { FileTree } from "./file-tree.tsx";
import { GitMark } from "./git-mark.tsx";
import { Markdown, MarkdownLine } from "./markdown.tsx";
import { StatusDot } from "./status-dot.tsx";

function Link(props: {
  node: StatusMark & Mark & { label?: string; link?: string };
  onOpen: (link: string) => void;
  /** Открыть объект отдельным табом — решение 0026. Ссылка не на объект иконки не получает. */
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
      className="truncate text-left text-[var(--mw-textLink-foreground)] hover:underline"
    >
      {text}
    </button>
  ) : (
    <span className="truncate" style={color ? { color } : undefined}>
      {text}
    </span>
  );

  return (
    <span className="group/link flex items-center gap-1">
      <StatusDot mark={node} />
      {body}
      <GitMark mark={node} />
      {tab && link && (
        <button
          type="button"
          onClick={() => tab(link)}
          title="Открыть отдельным табом"
          className="hidden shrink-0 opacity-60 group-hover/link:block hover:opacity-100"
        >
          {TabIcon}
        </button>
      )}
    </span>
  );
}

export function Display(props: {
  data: DisplayData;
  /** Whether the metric has run at all: a cell that never ran is not a cell with bad data. */
  collected: boolean;
  empty?: string;
  onOpen: (link: string) => void;
  /** Ссылка на объект открывается ещё и табом — решение 0026. Хост не умеет табы — нет её. */
  onOpenTab?: (link: string) => void;
  /**
   * Карту детей рисует подмодуль, а собирает его `compose`: слой `ui` чужие модули не тянет —
   * решение 0015.
   */
  renderMap: (map: { nodes: LinkNode[]; relations: MapRelation[] }) => ReactNode;
}) {
  const { data } = props;
  // Одним куском, чтобы не переписывать необязательное поле в каждой ветке ниже.
  const tab = props.onOpenTab === undefined ? {} : { onOpenTab: props.onOpenTab };

  const note = placeholder(data, props.collected, props.empty);
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
      return (
        <ul>
          {data.items.map((item, index) => (
            <li key={`${item.label ?? index}`} className="mb-1">
              <Link node={item} onOpen={props.onOpen} {...tab} />
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
    case "tree":
      return <FileTree nodes={data.children} onOpen={props.onOpen} {...tab} />;
    case "map":
      return props.renderMap({ nodes: data.nodes, relations: data.relations });
    default:
      return (
        <span className="text-[var(--mw-errorForeground)]" title={data.reason}>
          данные не той формы: {data.reason}
        </span>
      );
  }
}
