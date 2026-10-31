import type { OpenHow } from "@mapward/component";
import type { LinkItem } from "./types.ts";
import { TAB_TITLE, gitColor, isObjectLink, linkHover, openHow } from "./marks.ts";
import { GitMark, StatusDot } from "./status-dot.tsx";

/** Клик по пункту: что делать, говорит компонент; без обработчика клик ничего не делает. */
export type OnClick<T> = ((item: T, how: OpenHow) => void) | undefined;

/**
 * Подпись пункта: ссылкой, если она есть. Цвет git перебивает цвет ссылки: пометка про файл
 * важнее того, что по нему можно кликнуть.
 */
export function LinkText<T extends LinkItem>(props: { item: T; onClick?: OnClick<T> }) {
  const { item } = props;
  const text = item.label ?? item.link ?? "—";
  const color = gitColor(item);
  const link = item.link;
  if (!link) {
    return (
      <span className="truncate" style={color ? { color } : undefined}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(event) => props.onClick?.(item, openHow(link, event))}
      {...(isObjectLink(link) ? { title: TAB_TITLE } : {})}
      style={color ? { color } : undefined}
      className={`truncate text-left text-[var(--mw-textLink-foreground)] ${linkHover(link)}`}
    >
      {text}
    </button>
  );
}

/**
 * Ссылка с точкой статуса и пометкой git — как пункт списка. `onClick` — что делать по клику;
 * открыть ссылку как карта — `onClick={useNavigation()}`.
 */
export function Link(props: { item: LinkItem; onClick?: OnClick<LinkItem> }) {
  return (
    <span className="flex items-center gap-1">
      <StatusDot {...props.item} />
      <LinkText item={props.item} onClick={props.onClick} />
      <GitMark git={props.item.git} />
    </span>
  );
}
