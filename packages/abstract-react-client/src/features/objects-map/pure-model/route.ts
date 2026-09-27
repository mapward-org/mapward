import type { Point } from "@mapward/core";

/**
 * Путь стрелки через точки излома — связи и линии рисуются одинаково (решение 0044). Три режима:
 * ломаная — отрезки через изломы; скруглённая — те же отрезки со скруглениями на изломах; прямые
 * углы — от точки к точке только горизонталью и вертикалью, как ступенька.
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

/** Путь SVG через вершины: скругления — у скруглённой и у прямых углов, если просили. */
function draw(vertices: Point[], round: boolean): string {
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

export function routePath(points: Point[], route: Route = "straight"): string {
  return draw(corners(points, route), route === "rounded");
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
