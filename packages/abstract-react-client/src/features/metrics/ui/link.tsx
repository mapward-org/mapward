import type { ReactNode } from "react";
import type { GitMark as Mark, StatusMark } from "../pure-model/display.ts";
import { gitColor, isObjectLink } from "../pure-model/display.ts";
import { tabHover } from "../../../lib/ui/tab-hover.ts";

/** Строка ссылки: точка статуса, сама ссылка, пометка git — их кладёт `compose`. */
export function LinkLine(props: { children: ReactNode }) {
  return <span className="flex items-center gap-1">{props.children}</span>;
}

export function LinkText(props: {
  node: StatusMark & Mark & { label?: string; link?: string };
  onOpen: (link: string) => void;
  /**
   * Открыть объект отдельным табом ctrl + кликом — решение 0026. Иконки нет (0035): видно жест
   * подсветкой под ctrl, и ссылка не на объект её не получает.
   */
  onOpenTab?: ((link: string) => void) | undefined;
}) {
  const { node } = props;
  const text = node.label ?? node.link ?? "—";
  // Цвет git перебивает цвет ссылки: пометка про файл важнее того, что по нему можно кликнуть.
  const color = gitColor(node);
  const link = node.link;
  const tab = isObjectLink(link) ? props.onOpenTab : undefined;
  return link ? (
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
}

/** Список пунктов — дисплей `list`; его же берёт набор `@mapward/display` (решение 0037). */
export function LinkListFrame(props: { children: ReactNode }) {
  return <ul>{props.children}</ul>;
}

/**
 * Пункт списка: ссылка, справа от неё кнопка экшона (решение 0038), под ней — описание
 * разметкой: проверке нужны жирный, код и ссылки (0027).
 */
export function LinkListItem(props: {
  action?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="mb-1">
      {props.action !== undefined ? (
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1">{props.children}</span>
          {props.action}
        </div>
      ) : (
        props.children
      )}
      {props.description ? (
        <div className="pl-3 text-[11px] opacity-70">{props.description}</div>
      ) : null}
    </li>
  );
}
