import type { MapOp, Point } from "@mapward/core";

/**
 * Куда падает перетащенный узел — решение 0044. Считается один раз, на отпускание: узел падает
 * в самую глубокую группу под своим центром, а нет такой — на холст. Липкой границы нет: во
 * время перетаскивания ничего не решается, поэтому и случайного переноса на лету не бывает.
 */

export type Rect = { id: string; x: number; y: number; width: number; height: number };

const inside = (point: Point, rect: Rect) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

const within = (inner: string, outer: string) =>
  outer === "mapward://" || inner === outer || inner.startsWith(`${outer}/`);

/**
 * Группа под центром узла; `undefined` — холст. Сам узел и его жильцы целью не бывают: объект
 * нельзя перенести внутрь самого себя.
 */
export function dropTarget(params: {
  node: string;
  center: Point;
  /** Группы вьюхи, прямоугольниками на холсте целиком. */
  groups: Rect[];
}): string | undefined {
  // Самая глубокая — самая маленькая из тех, что под центром: вложенная меньше своей группы.
  return params.groups
    .filter((group) => !within(group.id, params.node))
    .filter((group) => inside(params.center, group))
    .toSorted((a, b) => a.width * a.height - b.width * b.height)[0]?.id;
}

/** Родительская папка по адресу: `mapward://a/b` → `mapward://a`, верхний → корень. */
export function parentAddress(address: string): string {
  const cut = address.lastIndexOf("/");
  const rest = address.slice("mapward://".length);
  return rest.includes("/") ? address.slice(0, cut) : "mapward://";
}

/**
 * Операция на отпускание. В своей группе — только сдвиг. В другую — перенос папки, с позицией
 * относительно новой группы. На холст из группы — объект уходит к родителю прежней группы по
 * адресу: это ближайшее место выше, и связи с группой он не теряет. Ссылка — не жилец: её папка
 * чужая и не переезжает, у неё меняется только позиция.
 */
export function dropOp(params: {
  view: string;
  node: string;
  kind: "object" | "ref";
  parent: string | undefined;
  target: string | undefined;
  /** Позиция относительно цели: группы или холста. */
  position: Point;
  /** Позиция относительно прежнего места — на случай, когда узел остаётся где был. */
  stay: Point;
}): MapOp {
  const { view, node } = params;
  if (params.kind === "ref" || params.target === params.parent) {
    return { op: "move-nodes", view, positions: { [node]: params.stay } };
  }
  const parent = params.target ?? parentAddress(params.parent ?? node);
  return { op: "move-object", view, object: node, parent, position: params.position };
}
