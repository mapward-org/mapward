import type { Point, Side } from "@mapward/core";

/**
 * Путь стрелки через точки излома — связи и линии рисуются одинаково (решение 0044). Три режима:
 * ломаная — отрезки через изломы; скруглённая — гладкая кривая, выходящая из стороны узла
 * перпендикулярно; прямые углы — только горизонталью и вертикалью, как ступенька.
 */
export type Route = "straight" | "rounded" | "orthogonal";

/** Радиус скругления: не больше половины короткого из двух отрезков, иначе дуга вылезет. */
const RADIUS = 12;

const fmt = (value: number) => Number(value.toFixed(2));
const move = (point: Point) => `M${fmt(point.x)},${fmt(point.y)}`;
const line = (point: Point) => `L${fmt(point.x)},${fmt(point.y)}`;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Точка на отрезке `a → b` на расстоянии `length` от `a`. */
const toward = (a: Point, b: Point, length: number): Point => {
  const whole = distance(a, b);
  if (whole === 0) return a;
  return { x: a.x + ((b.x - a.x) * length) / whole, y: a.y + ((b.y - a.y) * length) / whole };
};

/**
 * Ступенька между двумя точками: сначала по оси, где расстояние больше, потом вторая ось. Точки
 * на одной горизонтали или вертикали соединяются прямо.
 */
function steps(a: Point, b: Point): Point[] {
  if (a.x === b.x || a.y === b.y) return [];
  const across = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  return across
    ? [
        { x: (a.x + b.x) / 2, y: a.y },
        { x: (a.x + b.x) / 2, y: b.y },
      ]
    : [
        { x: a.x, y: (a.y + b.y) / 2 },
        { x: b.x, y: (a.y + b.y) / 2 },
      ];
}

/** Все вершины пути: у прямых углов между заданными точками появляются ступеньки. */
export function corners(points: Point[], route: Route): Point[] {
  if (route !== "orthogonal") return points;
  const out: Point[] = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous) out.push(...steps(previous, point));
    out.push(point);
  });
  return out;
}

/** Рамка узла на холсте целиком. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * Конец пути с прямыми углами. У конца на узле есть его рамка и сторона: стрелка выходит из неё
 * перпендикулярно и путь рамку не режет. Свободный конец — только точка.
 */
export type End = { point: Point; box?: Box | undefined; side?: Side | undefined };

/** Длина отрезка, которым стрелка сперва отходит от стороны узла. */
export const STUB = 20;

const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Ближайшая к точке сторона рамки — на ней конец и стоит. */
export function sideOf(box: Box, point: Point): Side {
  const sides: [Side, number][] = [
    ["top", Math.abs(point.y - box.y)],
    ["bottom", Math.abs(point.y - (box.y + box.height))],
    ["left", Math.abs(point.x - box.x)],
    ["right", Math.abs(point.x - (box.x + box.width))],
  ];
  return sides.reduce((best, side) => (side[1] < best[1] ? side : best))[0];
}

/** Середина стороны — откуда выходит плавающий конец пути с прямыми углами. */
export function sideMiddle(box: Box, side: Side): Point {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height / 2 };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height / 2 };
  }
}

const shift = (point: Point, side: Side, length: number): Point => ({
  x: point.x + NORMAL[side].x * length,
  y: point.y + NORMAL[side].y * length,
});

/** Режет ли отрезок по оси внутренность рамки — касание края не считается. */
function cuts(a: Point, b: Point, box: Box): boolean {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return (
    right > box.x + 0.5 &&
    left < box.x + box.width - 0.5 &&
    bottom > box.y + 0.5 &&
    top < box.y + box.height - 0.5
  );
}

const direction = (a: Point, b: Point): Point => ({
  x: Math.sign(b.x - a.x),
  y: Math.sign(b.y - a.y),
});

/** Убирает повторы и вершины посреди прямого отрезка. */
function tidy(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) continue;
    const before = out.at(-2);
    if (
      before &&
      last &&
      ((Math.abs(before.x - last.x) < 0.01 && Math.abs(last.x - point.x) < 0.01) ||
        (Math.abs(before.y - last.y) < 0.01 && Math.abs(last.y - point.y) < 0.01))
    ) {
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

/**
 * Ход от `a` к `b` горизонталями и вертикалями — лучший из кандидатов: прямо, углом, ступенькой
 * через середину и обходом вокруг рамок. Кандидат не режет рамки концов, не разворачивается
 * назад на выходе (`leave` — куда смотрит выход из `a`) и не входит в `b` против `enter` —
 * направления, которым путь должен прийти. Побеждает короткий с меньшим числом углов.
 */
function leg(a: Point, b: Point, boxes: Box[], leave?: Point, enter?: Point): Point[] {
  const xs = [a.x, b.x, (a.x + b.x) / 2];
  const ys = [a.y, b.y, (a.y + b.y) / 2];
  for (const box of boxes) {
    xs.push(box.x - STUB, box.x + box.width + STUB);
    ys.push(box.y - STUB, box.y + box.height + STUB);
  }
  const candidates: Point[][] = [
    [a, b],
    [a, { x: b.x, y: a.y }, b],
    [a, { x: a.x, y: b.y }, b],
  ];
  for (const x of xs) candidates.push([a, { x, y: a.y }, { x, y: b.y }, b]);
  for (const y of ys) candidates.push([a, { x: a.x, y }, { x: b.x, y }, b]);

  let best: { path: Point[]; score: number } | undefined;
  for (const raw of candidates) {
    const path = tidy(raw);
    const segments = path.slice(1).map((point, index) => [path[index] ?? point, point] as const);
    if (segments.some(([p, q]) => p.x !== q.x && p.y !== q.y)) continue;
    if (segments.some(([p, q]) => boxes.some((box) => cuts(p, q, box)))) continue;
    const first = segments[0];
    const last = segments.at(-1);
    if (first && leave) {
      const way = direction(first[0], first[1]);
      if (way.x === -leave.x && way.y === -leave.y && (way.x !== 0 || way.y !== 0)) continue;
    }
    if (last && enter) {
      const way = direction(last[0], last[1]);
      if (way.x === -enter.x && way.y === -enter.y && (way.x !== 0 || way.y !== 0)) continue;
    }
    const length = segments.reduce((sum, [p, q]) => sum + distance(p, q), 0);
    const score = length + (path.length - 2) * 40;
    if (!best || score < best.score) best = { path, score };
  }
  return best?.path ?? tidy([a, ...steps(a, b), b]);
}

/**
 * Путь с прямыми углами, как в Miro: из стороны узла — коротким отрезком наружу, перпендикулярно
 * ей; в цель — так же; между ними горизонтали и вертикали, которые не режут рамки концов. Изломы,
 * поставленные руками, — точки, через которые путь обязан пройти. Чужие узлы путь не обходит.
 */
export function orthogonal(from: End, to: End, bends: Point[] = []): Point[] {
  const boxes = [from.box, to.box].filter((box): box is Box => box !== undefined);
  const start = from.side ? shift(from.point, from.side, STUB) : from.point;
  const finish = to.side ? shift(to.point, to.side, STUB) : to.point;
  const stops = [start, ...bends, finish];
  const out: Point[] = [from.point, start];
  stops.slice(1).forEach((stop, index) => {
    const previous = stops[index] ?? start;
    const leave = index === 0 && from.side ? NORMAL[from.side] : undefined;
    const last = index === stops.length - 2;
    // Входя в цель, путь идёт к её стороне, то есть против её нормали.
    const enter = last && to.side ? { x: -NORMAL[to.side].x, y: -NORMAL[to.side].y } : undefined;
    out.push(...leg(previous, stop, boxes, leave, enter).slice(1));
  });
  out.push(to.point);
  return tidy(out);
}

/** Путь SVG через вершины: скругления на углах — если просили. */
export function draw(vertices: Point[], round: boolean): string {
  const [first, ...rest] = vertices;
  if (!first) return "";
  const parts = [move(first)];
  rest.forEach((point, index) => {
    const before = vertices[index] ?? first;
    const after = rest[index + 1];
    if (!round || !after) {
      parts.push(line(point));
      return;
    }
    const radius = Math.min(RADIUS, distance(before, point) / 2, distance(point, after) / 2);
    const enter = toward(point, before, radius);
    const leave = toward(point, after, radius);
    parts.push(line(enter), `Q${fmt(point.x)},${fmt(point.y)} ${fmt(leave.x)},${fmt(leave.y)}`);
  });
  return parts.join(" ");
}

/** Путь через точки по отрезкам: ломаная или ступеньки прямых углов. Кривую строит `curve`. */
export function routePath(points: Point[], route: Route = "straight"): string {
  return draw(corners(points, route), false);
}

/** Кривая с подписью на середине и ручками «создать излом» на трети каждого её участка. */
export type Curve = { path: string; label: Point | undefined; inserts: Point[] };

/** Насколько далеко тянет касательная у стороны узла — доля участка, но не короче выхода. */
const PULL = 0.4;

type Cubic = [Point, Point, Point, Point];

const along = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Точка кубической кривой Безье при `t`. */
function at([p0, p1, p2, p3]: Cubic, t: number): Point {
  const a = along(p0, p1, t);
  const b = along(p1, p2, t);
  const c = along(p2, p3, t);
  return along(along(a, b, t), along(b, c, t), t);
}

/**
 * Скруглённая связь — гладкая кривая, как в Miro. Конец на узле выходит из своей стороны
 * перпендикулярно ей и так же входит в цель; через изломы кривая идёт плавно, касательной вдоль
 * соседних точек. Свободный конец смотрит на соседнюю точку. Рамки кривая не обходит: цель позади
 * стороны выхода даёт петлю.
 */
export function curve(from: End, to: End, bends: Point[] = []): Curve {
  const points = [from.point, ...bends, to.point];
  const last = points.length - 1;
  // Касательная излома — вдоль соседей, длиной в треть участка: так соседние участки стыкуются гладко.
  const smooth = (index: number, length: number, sign: 1 | -1): Point => {
    const point = points[index] ?? from.point;
    const before = points[index - 1] ?? point;
    const after = points[index + 1] ?? point;
    const span = distance(before, after);
    if (span === 0) return point;
    const k = (sign * length) / 3 / span;
    return { x: point.x + (after.x - before.x) * k, y: point.y + (after.y - before.y) * k };
  };
  const pull = (length: number) => Math.max(STUB, length * PULL);
  const cubics = points.slice(1).map((q, index): Cubic => {
    const p = points[index] ?? q;
    const length = distance(p, q);
    const leave =
      index > 0
        ? smooth(index, length, 1)
        : from.side
          ? shift(p, from.side, pull(length))
          : toward(p, q, length / 3);
    const enter =
      index + 1 < last
        ? smooth(index + 1, length, -1)
        : to.side
          ? shift(q, to.side, pull(length))
          : toward(q, p, length / 3);
    return [p, leave, enter, q];
  });
  const [first] = points;
  const path = first
    ? [
        move(first),
        ...cubics.map(
          ([, c1, c2, q]) =>
            `C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(q.x)},${fmt(q.y)}`,
        ),
      ].join(" ")
    : "";
  const middle = cubics[Math.floor(cubics.length / 2)];
  return {
    path,
    label: middle && at(middle, 0.5),
    inserts: cubics.map((cubic) => at(cubic, 1 / 3)),
  };
}

/**
 * Где стоит подпись и где ручки «создать излом». Подпись — середина среднего отрезка, ручки — на
 * трети каждого отрезка: так ручка не ложится на подпись, а у длинного отрезка до неё легко
 * дотянуться.
 */
export function handles(points: Point[]): { label: Point | undefined; inserts: Point[] } {
  const segments = points.slice(1).map((point, index) => [points[index] ?? point, point] as const);
  const inserts = segments.map(([a, b]) => ({
    x: a.x + (b.x - a.x) / 3,
    y: a.y + (b.y - a.y) / 3,
  }));
  const middle = segments[Math.floor(segments.length / 2)];
  const label = middle
    ? { x: (middle[0].x + middle[1].x) / 2, y: (middle[0].y + middle[1].y) / 2 }
    : undefined;
  return { label, inserts };
}
