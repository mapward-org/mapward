import type { Point } from "@mapward/core";

/**
 * Где связь касается узла — решение 0044. По умолчанию конец плавающий: точка на рамке узла по
 * направлению к следующей точке пути (излому или центру другого узла), поэтому стрелка выходит
 * с той стороны, куда смотрит, а не всегда снизу. Закреплённый конец — точка рамки в долях её
 * ширины и высоты: узел растянули — конец остался на той же стороне.
 */

export type Frame = { x: number; y: number; width: number; height: number };
export type Anchor = { x: number; y: number };

export const center = (frame: Frame): Point => ({
  x: frame.x + frame.width / 2,
  y: frame.y + frame.height / 2,
});

/** Точка рамки по лучу из центра к `toward`; `toward` в центре — середина верхней стороны. */
export function floating(frame: Frame, toward: Point): Point {
  const middle = center(frame);
  const dx = toward.x - middle.x;
  const dy = toward.y - middle.y;
  if (dx === 0 && dy === 0) return { x: middle.x, y: frame.y };
  const halfW = frame.width / 2;
  const halfH = frame.height / 2;
  // До какой стороны луч дойдёт раньше: по горизонтали или по вертикали.
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy),
  );
  return { x: middle.x + dx * scale, y: middle.y + dy * scale };
}

/** Закреплённый конец на холсте. */
export const anchored = (frame: Frame, anchor: Anchor): Point => ({
  x: frame.x + frame.width * anchor.x,
  y: frame.y + frame.height * anchor.y,
});

/** Конец связи: закреплённый, если задан, иначе плавающий к `toward`. */
export const endPoint = (frame: Frame, anchor: Anchor | undefined, toward: Point): Point =>
  anchor ? anchored(frame, anchor) : floating(frame, toward);

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Куда встаёт перетащенный конец: ближайшая к курсору точка рамки, в долях. Курсор внутри или
 * снаружи узла — конец всё равно на рамке: связь касается узла, а не лежит в нём.
 */
export function snapToFrame(frame: Frame, point: Point): Anchor {
  const x = clamp((point.x - frame.x) / frame.width);
  const y = clamp((point.y - frame.y) / frame.height);
  const sides = [
    { d: Math.abs(point.y - frame.y), anchor: { x, y: 0 } },
    { d: Math.abs(point.y - (frame.y + frame.height)), anchor: { x, y: 1 } },
    { d: Math.abs(point.x - frame.x), anchor: { x: 0, y } },
    { d: Math.abs(point.x - (frame.x + frame.width)), anchor: { x: 1, y } },
  ];
  const nearest = sides.reduce((best, side) => (side.d < best.d ? side : best));
  return {
    x: Number(nearest.anchor.x.toFixed(3)),
    y: Number(nearest.anchor.y.toFixed(3)),
  };
}
