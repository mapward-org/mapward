import type { ObjectsMap, Point, ViewNode } from "@mapward/core";

/**
 * Где и какого размера узел на холсте. Позиция приходит из состояния вьюхи; у узла без неё — ряд
 * по порядку, честный, хоть и некрасивый. Группа растягивается под своих жильцов: библиотека
 * холста размер родителя не считает, а жилец за рамкой выглядел бы вынесенным из группы.
 */

export type Box = { id: string; parent?: string; position: Point; width: number; height: number };

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

function ownSize(node: ViewNode): { width: number; height: number } {
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

export function layout(map: Pick<ObjectsMap, "nodes">): Box[] {
  const children = new Map<string | undefined, ViewNode[]>();
  for (const node of map.nodes) {
    const list = children.get(node.parent) ?? [];
    list.push(node);
    children.set(node.parent, list);
  }

  const boxes = new Map<string, Box>();
  const measure = (node: ViewNode, index: number): Box => {
    const inside = children.get(node.id) ?? [];
    const placed = node.expanded ? inside.map((child, i) => measure(child, i)) : [];
    const own = ownSize(node);
    const width = Math.max(
      own.width,
      ...placed.map((box) => box.position.x + box.width + PAD.side),
    );
    const height = Math.max(
      own.height,
      ...placed.map((box) => box.position.y + box.height + PAD.side),
    );
    const size = { width, height };
    const box: Box = {
      id: node.id,
      ...(node.parent === undefined ? {} : { parent: node.parent }),
      position: node.position ?? slot(index, node.parent !== undefined, own),
      ...size,
    };
    boxes.set(node.id, box);
    return box;
  };

  (children.get(undefined) ?? []).forEach((node, index) => measure(node, index));
  // Родитель раньше детей — так библиотека холста и ждёт; порядок узлов вьюхи уже такой.
  return map.nodes.map((node) => boxes.get(node.id)).filter((box): box is Box => box !== undefined);
}

/** Положение узла на холсте целиком: своя позиция плюс позиции всех групп над ним. */
export function absolute(boxes: Box[], id: string): Point {
  const byId = new Map(boxes.map((box) => [box.id, box]));
  let point = { x: 0, y: 0 };
  let current = byId.get(id);
  while (current) {
    point = { x: point.x + current.position.x, y: point.y + current.position.y };
    current = current.parent === undefined ? undefined : byId.get(current.parent);
  }
  return point;
}
