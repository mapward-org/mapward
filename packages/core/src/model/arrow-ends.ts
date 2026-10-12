import * as T from "typebox";
import type { Static } from "typebox";
import type { ArrowStyle, ObjectsMap, Point } from "./objects-map.ts";
import { absolute, layout } from "./node-layout.ts";

/**
 * Где стрелка касается узлов. Новая связь закреплена с рождения: каждый конец — в середине своей
 * стороны, и путь выходит из неё перпендикулярно, сколько узлы ни двигай. Плавающий конец
 * остаётся у старых связей и у откреплённых двойным кликом.
 */

/** Сторона рамки узла, из которой выходит конец стрелки. */
export const Side = T.Union([
  T.Literal("top"),
  T.Literal("right"),
  T.Literal("bottom"),
  T.Literal("left"),
]);
export type Side = Static<typeof Side>;

/** Рамка узла на холсте целиком. */
export type Frame = { x: number; y: number; width: number; height: number };

/** Середина стороны в долях рамки — так закреплённый конец и записан в стиле стрелки. */
export function sideAnchor(side: Side): Point {
  switch (side) {
    case "top":
      return { x: 0.5, y: 0 };
    case "right":
      return { x: 1, y: 0.5 };
    case "bottom":
      return { x: 0.5, y: 1 };
    case "left":
      return { x: 0, y: 0.5 };
  }
}

/**
 * Сторона, которая смотрит на точку: по оси, где до неё дальше, — так стрелка между карточками
 * рядом выходит навстречу, а не вбок.
 */
export function facing(box: Frame, target: Point): Side {
  const dx = target.x - (box.x + box.width / 2);
  const dy = target.y - (box.y + box.height / 2);
  if (Math.abs(dx) / box.width >= Math.abs(dy) / box.height) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

const middle = (box: Frame): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * Закрепление новой стрелки между узлами вьюхи. Названная сторона берётся как есть, не названная —
 * обращённая к другому узлу по раскладке, которой рисует холст: сервер узлов не измеряет, но
 * размеры из стиля дают ту же сторону. Узла нет на вьюхе — закреплять не к чему.
 */
export function pinnedEnds(
  map: Pick<ObjectsMap, "nodes">,
  from: string,
  to: string,
  sides: { from?: Side | undefined; to?: Side | undefined } = {},
): Pick<ArrowStyle, "fromAnchor" | "toAnchor"> | undefined {
  const boxes = layout(map);
  const frame = (id: string): Frame | undefined => {
    const box = boxes.find((item) => item.id === id);
    if (!box) return undefined;
    return { ...absolute(boxes, id), width: box.width, height: box.height };
  };
  const a = frame(from);
  const b = frame(to);
  if (!a || !b) return undefined;
  return {
    fromAnchor: sideAnchor(sides.from ?? facing(a, middle(b))),
    toAnchor: sideAnchor(sides.to ?? facing(b, middle(a))),
  };
}
