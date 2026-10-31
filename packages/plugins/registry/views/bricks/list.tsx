import type { LinkItem } from "./types.ts";
import { isCard } from "./types.ts";
import { RowAction, WithRowMenu } from "./action-button.tsx";
import { ItemCard } from "./card.tsx";
import { Link, type OnClick } from "./link.tsx";
import { Markdown } from "./markdown.tsx";

/**
 * Пункт: ссылка, справа от неё кнопка экшона, под ней — описание разметкой. Ссылки в описании
 * идут тем же `onClick`, что и сам пункт: компонент получает пункт со ссылкой из текста.
 */
function Row(props: { item: LinkItem; onClick: OnClick<LinkItem> }) {
  const { item, onClick } = props;
  const line = (
    <WithRowMenu actions={item.actions}>
      <Link item={item} onClick={onClick} />
    </WithRowMenu>
  );
  return (
    <li className="mb-1">
      {item.action ? (
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1">{line}</span>
          <RowAction action={item.action} />
        </div>
      ) : (
        line
      )}
      {item.description && (
        <div className="pl-3 text-[11px] opacity-70">
          <Markdown
            text={item.description}
            inline
            onOpen={onClick && ((link, how) => onClick({ link }, how))}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Список пунктов — как у вида `list`. Пункт с `object` — карточка объекта во всю ширину.
 * `empty` — что сказать, когда пунктов нет. `onClick` — что делать по клику на пункт.
 */
export function List(props: { items: LinkItem[]; empty?: string; onClick?: OnClick<LinkItem> }) {
  if (props.items.length === 0)
    return <span className="opacity-60">{props.empty ?? "нет таких"}</span>;
  return (
    <ul>
      {props.items.map((item, index) =>
        isCard(item) ? (
          <li key={item.object} className="mb-1.5">
            <ItemCard item={item} />
          </li>
        ) : (
          <Row key={item.label ?? index} item={item} onClick={props.onClick} />
        ),
      )}
    </ul>
  );
}
