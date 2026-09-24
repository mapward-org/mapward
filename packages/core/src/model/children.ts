import type { MapObject } from "./model.ts";
import type { LinkNode, MapRelation, ObjectRef } from "./display.ts";

/** Карта детей — это данные дисплея `map`, поэтому и формы у неё оттуда же. */
export type MapNode = LinkNode;
export type ChildrenMap = { nodes: MapNode[]; relations: MapRelation[] };

/**
 * Globs here are simple on purpose: `prototypes/*` means the children of that group and not
 * their children. A regexp would need escaping and buy nothing — map addresses have no
 * special characters.
 */
function matches(address: string, glob: string): boolean {
  const relative = address.replace("mapward://", "");
  if (!glob.includes("*")) return relative === glob;

  const [head = ""] = glob.split("*");
  return relative.startsWith(head) && !relative.slice(head.length).includes("/");
}

/**
 * A child with `from` and `to` in its props is a relation, everything else is a node —
 * decision 0004. Groups have no `_index.json` of their own, so their children rise a level:
 * a group is a folder, not a thing on the map.
 */
export function childrenMap(
  object: MapObject,
  exclude: string[] = [],
  include: string[] = [],
  /**
   * Как показать узлы карточками: вкладка и размер — у всех узлов сразу. Размер — свойство
   * места, где карточка нарисована, поэтому живёт в конфиге коллектора, а не у объекта.
   */
  card: Omit<ObjectRef, "object"> = {},
): ChildrenMap {
  const nodes: MapNode[] = [];
  const relations: MapRelation[] = [];

  const visit = (child: MapObject) => {
    if (exclude.some((glob) => matches(child.address, glob))) return;

    if (child.isGroup) {
      for (const inner of child.children) visit(inner);
      return;
    }

    // `exclude` режет ветку целиком, а `include` спрашивается только у того, кто попал бы на
    // карту: группа — это папка, её адрес на карте не показывается, и отбор по нему вырезал бы
    // всё вместе с ней. Пустой `include` не отбирает ничего — иначе он значил бы «ничего».
    if (include.length > 0 && !include.some((glob) => matches(child.address, glob))) return;

    const { from, to } = child.props as { from?: string; to?: string };
    if (from && to) relations.push({ label: child.name, link: child.address, from, to });
    else nodes.push({ label: child.name, link: child.address, object: child.address, ...card });
  };

  for (const child of object.children) visit(child);
  return { nodes, relations };
}
