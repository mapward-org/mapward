import type { OpenHow } from "@mapward/component";
import type { LinkItem } from "./types.ts";
import { placeholder, toShape } from "./shape.ts";
import { ItemCard } from "./card.tsx";
import { FileTree } from "./file-tree.tsx";
import { Link } from "./link.tsx";
import { List } from "./list.tsx";
import { Markdown, type OnOpen } from "./markdown.tsx";
import { StatusDot } from "./status-dot.tsx";

/**
 * Значение по виду: `text`, `markdown`, `link`, `status`, `list`, `tree`, `object` — им рисуют
 * готовые виды плагина `views`. Данные не той формы — так и говорится. `onOpen` — клик по ссылке
 * в значении: у пункта списка и дерева — по его `link`. `id` — где дерево помнит раскрытые папки
 * (как у `FileTree`).
 */
export function Display(props: {
  kind: string | undefined;
  data: unknown;
  empty?: string | undefined;
  onOpen?: OnOpen;
  id?: string | undefined;
}) {
  const shape = toShape(props.kind, props.data);
  const note = placeholder(shape, props.data, props.empty);
  if (note) return <span className="opacity-60">{note}</span>;

  const onOpen = props.onOpen;
  const onClick =
    onOpen &&
    ((item: LinkItem, how: OpenHow) => {
      if (item.link) onOpen(item.link, how);
    });

  switch (shape.kind) {
    case "text":
      return <span>{shape.text}</span>;
    case "markdown":
      return <Markdown text={shape.text} onOpen={onOpen} />;
    case "link":
      return <Link item={shape.item} onClick={onClick} />;
    case "status":
      return (
        <span className="flex items-center gap-1">
          <StatusDot status={shape.ok ? "success" : "fail"} />
          <span>{shape.summary ?? (shape.ok ? "ок" : "не ок")}</span>
        </span>
      );
    case "list":
      return <List items={shape.items} onClick={onClick} />;
    case "tree":
      return props.id === undefined ? (
        <FileTree items={shape.children} onClick={onClick} />
      ) : (
        <FileTree items={shape.children} id={props.id} onClick={onClick} />
      );
    case "object":
      return <ItemCard item={shape.item} />;
    default:
      return (
        <span className="text-[var(--mw-errorForeground)]" title={shape.reason}>
          данные не той формы: {shape.reason}
        </span>
      );
  }
}
