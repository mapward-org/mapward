import { ObjectCard } from "@mapward/component";
import type { CardItem } from "./types.ts";

/**
 * Пункт с `object` — карточка объекта: имя, кнопки объекта и сетка его превью. Ширину задаёт
 * место, где она стоит, если пункт не назвал свою.
 */
export function ItemCard(props: { item: CardItem }) {
  const { item } = props;
  return (
    <ObjectCard
      object={item.object}
      {...(item.group === undefined ? {} : { group: item.group })}
      {...(item.width === undefined ? {} : { width: item.width })}
      {...(item.maxHeight === undefined ? {} : { maxHeight: item.maxHeight })}
    />
  );
}
