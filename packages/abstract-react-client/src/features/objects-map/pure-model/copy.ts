import type { MapOp, Point, ViewShape } from "@mapward/core";

/**
 * Копирование на холсте. В буфере адреса, а не снимок: копия берёт объект таким, каков он в
 * момент вставки. Буфер системный — Ctrl+V работает между вкладками и окнами, — но вставка идёт
 * только в ту же карту: адреса прототипов в чужой карте ничего не значат.
 */
export type Clip = {
  kind: typeof CLIP_KIND;
  /** Карта, из которой скопировали. */
  map: string;
  /** Верхние скопированные объекты и их левый верхний угол на холсте. */
  objects: { address: string; at: Point }[];
  /** Фигуры-пометки — они живут во вьюхе и копируются целиком, с новым номером. */
  shapes: ViewShape[];
};

const CLIP_KIND = "mapward-copy";

/** Сдвиг копии, когда курсора над холстом нет: рядом с оригиналом, а не поверх него. */
export const PASTE_NUDGE = 24;

export const clipText = (clip: Omit<Clip, "kind">): string =>
  JSON.stringify({ kind: CLIP_KIND, ...clip });

/** Текст буфера — наша копия или чужой текст, который холст не трогает. */
export function readClip(text: string): Clip | undefined {
  try {
    const value = JSON.parse(text) as Partial<Clip> | null;
    if (value?.kind !== CLIP_KIND || typeof value.map !== "string") return undefined;
    return {
      kind: CLIP_KIND,
      map: value.map,
      objects: Array.isArray(value.objects) ? value.objects : [],
      shapes: Array.isArray(value.shapes) ? value.shapes : [],
    };
  } catch {
    return undefined;
  }
}

const within = (inner: string, outer: string) =>
  outer === "mapward://" || inner === outer || inner.startsWith(`${outer}/`);

/** Жилец скопированной группы едет с ней: отдельно его не копируют. */
export const topsOf = <T extends { address: string }>(items: T[]): T[] =>
  items.filter(
    (item) => !items.some((other) => other !== item && within(item.address, other.address)),
  );

/**
 * Операции вставки. Левый верхний угол копии встаёт под курсор, взаимное расположение
 * сохраняется; курсора нет — копия чуть в стороне. Объекты кладутся одной операцией в группу под
 * курсором, а нет её — в место для новых объектов вьюхи.
 */
export function pasteOps(params: {
  view: string;
  clip: Clip;
  /** Точка холста под курсором. */
  point: Point | undefined;
  /** Группа под курсором. */
  target: string | undefined;
  /** Точка холста — в координаты группы. */
  relative: (target: string | undefined, point: Point) => Point;
  newShapeId: () => string;
}): MapOp[] {
  const { view, clip } = params;
  const shapes = clip.shapes.filter((shape) => shape.kind !== "line");
  const corners = [...clip.objects.map((item) => item.at), ...shapes];
  if (corners.length === 0) return [];
  const left = Math.min(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y));
  const shift = params.point
    ? { x: params.point.x - left, y: params.point.y - top }
    : { x: PASTE_NUDGE, y: PASTE_NUDGE };
  const moved = (at: Point) => ({ x: at.x + shift.x, y: at.y + shift.y });

  const ops: MapOp[] = shapes.map((shape) => ({
    op: "put-shape",
    view,
    shape: { ...shape, id: params.newShapeId(), ...moved(shape) },
  }));
  const objects = topsOf(clip.objects);
  if (objects.length > 0) {
    ops.push({
      op: "copy-objects",
      view,
      objects: objects.map((item) => item.address),
      ...(params.target === undefined ? {} : { parent: params.target }),
      positions: Object.fromEntries(
        objects.map((item) => [item.address, params.relative(params.target, moved(item.at))]),
      ),
    });
  }
  return ops;
}
