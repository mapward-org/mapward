import type { ReactNode } from "react";
import type {
  DisplayData,
  GitMark as Mark,
  LinkNode,
  MapRelation,
  StatusMark,
} from "../pure-model/display.ts";
import { gitColor, placeholder } from "../pure-model/display.ts";
import { FileTree } from "./file-tree.tsx";
import { GitMark } from "./git-mark.tsx";
import { Markdown, MarkdownLine } from "./markdown.tsx";
import { StatusDot } from "./status-dot.tsx";

function Link(props: {
  node: StatusMark & Mark & { label?: string; link?: string };
  onOpen: (link: string) => void;
}) {
  const { node } = props;
  const text = node.label ?? node.link ?? "—";
  // Цвет git перебивает цвет ссылки: пометка про файл важнее того, что по нему можно кликнуть.
  const color = gitColor(node);
  const body = node.link ? (
    <button
      type="button"
      onClick={() => props.onOpen(node.link ?? "")}
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
    <span className="flex items-center gap-1">
      <StatusDot mark={node} />
      {body}
      <GitMark mark={node} />
    </span>
  );
}

export function Display(props: {
  data: DisplayData;
  /** Whether the metric has run at all: a cell that never ran is not a cell with bad data. */
  collected: boolean;
  empty?: string;
  onOpen: (link: string) => void;
  /**
   * Карту детей рисует подмодуль, а собирает его `compose`: слой `ui` чужие модули не тянет —
   * решение 0015.
   */
  renderMap: (map: { nodes: LinkNode[]; relations: MapRelation[] }) => ReactNode;
}) {
  const { data } = props;

  const note = placeholder(data, props.collected, props.empty);
  if (note) return <span className="opacity-60">{note}</span>;

  switch (data.kind) {
    case "text":
      return <span>{data.text}</span>;
    // Тексты в значениях метрик лежали и раньше; этот дисплей их наконец показывает как текст,
    // а не как одну длинную строку — решение 0027.
    case "markdown":
      return <Markdown text={data.text} onOpen={props.onOpen} />;
    case "link":
      return <Link node={data.node} onOpen={props.onOpen} />;
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
              <Link node={item} onOpen={props.onOpen} />
              {item.description && (
                <div className="pl-3 text-[11px] opacity-70">
                  {/* Вторая строка — тоже разметка: проверке нужны жирный, код и ссылки (0027). */}
                  <MarkdownLine text={item.description} onOpen={props.onOpen} />
                </div>
              )}
            </li>
          ))}
        </ul>
      );
    case "tree":
      return <FileTree nodes={data.children} onOpen={props.onOpen} />;
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
