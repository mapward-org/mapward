import type { MapObject } from "../../pure-model/model.ts";

export type MapNode = { label?: string; link?: string };
export type MapRelation = { label?: string; link?: string; from?: string; to?: string };
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
export function childrenMap(object: MapObject, exclude: string[] = []): ChildrenMap {
  const nodes: MapNode[] = [];
  const relations: MapRelation[] = [];

  const visit = (child: MapObject) => {
    if (exclude.some((glob) => matches(child.address, glob))) return;

    if (child.isGroup) {
      for (const inner of child.children) visit(inner);
      return;
    }

    const { from, to } = child.props as { from?: string; to?: string };
    if (from && to) relations.push({ label: child.name, link: child.address, from, to });
    else nodes.push({ label: child.name, link: child.address });
  };

  for (const child of object.children) visit(child);
  return { nodes, relations };
}
