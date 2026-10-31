import type { ArrowStyle, ObjectsMap, Point, Side, ViewNode } from "../model/types.ts";

/**
 * Раскладка холста — где и какого размера узел и где стрелка касается узлов. Знает её холст: по
 * ней он рисует, и по ней же процесс плагина закрепляет концы новой стрелки (`pin` у `planEdit`),
 * — одна копия на обе стороны, иначе сторона на холсте и в файле разошлись бы.
 *
 * Где и какого размера узел на холсте. Позиция приходит из состояния вьюхи; у узла без неё — ряд
 * по порядку, честный, хоть и некрасивый. Нерастянутая группа растёт под своих жильцов: библиотека
 * холста размер родителя не считает, а жилец за рамкой выглядел бы вынесенным из группы.
 */

export type NodeBox = {
  id: string;
  parent?: string;
  position: Point;
  width: number;
  height: number;
};

/** Простая карточка — фигура с подписью. */
export const SIMPLE = { width: 160, height: 48 };
/** Полное превью, пока вьюха не задала ширину: узлы не должны наезжать на соседей. */
export const PREVIEW = { width: 280, height: 200 };
/** Поля группы: сверху — место под подпись и кнопки. */
export const PAD = { side: 16, top: 40 };
const GAP = { x: 24, y: 24 };

const pixels = (size: string | number | undefined, fallback: number): number => {
  if (typeof size === "number") return size;
  const parsed = size === undefined ? Number.NaN : Number.parseFloat(size);
  return Number.isFinite(parsed) && /^\d+(\.\d+)?(px)?$/.test(size ?? "") ? parsed : fallback;
};

/** Развёрнутая группа, пока её не растянули руками: места хватает бросить внутрь пару стикеров. */
export const ROOM = { width: 360, height: 220 };

function ownSize(node: ViewNode): { width: number; height: number } {
  // Растянутое руками перекрывает стиль вьюхи.
  if (node.size) return node.size;
  if (node.expanded) return ROOM;
  return node.view === "preview"
    ? { width: pixels(node.width, PREVIEW.width), height: pixels(node.maxHeight, PREVIEW.height) }
    : SIMPLE;
}

/** Ряд по три для узла без позиции: у группы — внутри её полей, на холсте — от нуля. */
function slot(index: number, inside: boolean, size: { width: number; height: number }): Point {
  const x = (index % 3) * (size.width + GAP.x);
  const y = Math.floor(index / 3) * (size.height + GAP.y);
  return inside ? { x: x + PAD.side, y: y + PAD.top } : { x, y };
}

export function layout(map: Pick<ObjectsMap, "nodes">): NodeBox[] {
  const children = new Map<string | undefined, ViewNode[]>();
  for (const node of map.nodes) {
    const list = children.get(node.parent) ?? [];
    list.push(node);
    children.set(node.parent, list);
  }

  const boxes = new Map<string, NodeBox>();
  const measure = (node: ViewNode, index: number): NodeBox => {
    const inside = children.get(node.id) ?? [];
    const placed = node.expanded ? inside.map((child, i) => measure(child, i)) : [];
    const own = ownSize(node);
    // Растянутый руками фрейм — ровно такой, как его растянули, как в Miro: жилец может и
    // выглядывать за край. Нерастянутый дорастает до жильцов, чтобы никто не оказался снаружи.
    const fit = (extent: (box: NodeBox) => number, base: number) =>
      node.size ? base : Math.max(base, ...placed.map(extent));
    const size = {
      width: fit((box) => box.position.x + box.width + PAD.side, own.width),
      height: fit((box) => box.position.y + box.height + PAD.side, own.height),
    };
    const box: NodeBox = {
      id: node.id,
      ...(node.parent === undefined ? {} : { parent: node.parent }),
      position: node.position ?? slot(index, node.parent !== undefined, own),
      ...size,
    };
    boxes.set(node.id, box);
    return box;
  };

  (children.get(undefined) ?? []).forEach((node, index) => measure(node, index));
  // Родитель раньше детей — так библиотека холста и ждёт. У вьюхи порядок уже такой, а узел,
  // только что брошенный в фрейм, может стоять раньше фрейма: без сортировки он бы моргнул.
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const depth = (node: ViewNode): number => {
    const parent = node.parent === undefined ? undefined : byId.get(node.parent);
    return parent ? depth(parent) + 1 : 0;
  };
  return map.nodes
    .toSorted((a, b) => depth(a) - depth(b))
    .map((node) => boxes.get(node.id))
    .filter((box): box is NodeBox => box !== undefined);
}

/** Положение узла на холсте целиком: своя позиция плюс позиции всех групп над ним. */
export function absolute(boxes: NodeBox[], id: string): Point {
  const byId = new Map(boxes.map((box) => [box.id, box]));
  let point = { x: 0, y: 0 };
  let current = byId.get(id);
  while (current) {
    point = { x: point.x + current.position.x, y: point.y + current.position.y };
    current = current.parent === undefined ? undefined : byId.get(current.parent);
  }
  return point;
}

/**
 * Где стрелка касается узлов. Новая связь закреплена с рождения: каждый конец — в середине своей
 * стороны, и путь выходит из неё перпендикулярно, сколько узлы ни двигай. Плавающий конец
 * остаётся у старых связей и у откреплённых двойным кликом.
 */

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
 * обращённая к другому узлу по раскладке, которой рисует холст: плагин узлов не измеряет, но
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
