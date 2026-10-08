import { expect, test } from "vitest";
import type { Point } from "@mapward/core";
import type { Box } from "./route.ts";
import { corners, facing, handles, orthogonal, routePath, sideMiddle, sideOf } from "./route.ts";

const a = { x: 0, y: 0 };
const b = { x: 100, y: 50 };

test("a broken line goes straight through the bends", () => {
  expect(routePath([a, { x: 50, y: 0 }, b])).toBe("M0,0 L50,0 L100,50");
});

test("a rounded line curves at each bend, not at the ends", () => {
  const path = routePath([a, { x: 50, y: 0 }, b], "rounded");
  expect(path.startsWith("M0,0 L38,0 Q50,0 ")).toBe(true);
  expect(path.endsWith("L100,50")).toBe(true);
});

test("right angles step horizontally and vertically between points", () => {
  expect(corners([a, b], "orthogonal")).toEqual([a, { x: 50, y: 0 }, { x: 50, y: 50 }, b]);
  expect(routePath([a, b], "orthogonal")).toBe("M0,0 L50,0 L50,50 L100,50");
  // Точки на одной горизонтали — ступенька не нужна.
  expect(corners([a, { x: 80, y: 0 }], "orthogonal")).toHaveLength(2);
});

test("handles to insert a bend sit at a third of the segment, away from the label", () => {
  const { label, inserts } = handles([a, { x: 90, y: 0 }]);
  expect(label).toEqual({ x: 45, y: 0 });
  expect(inserts).toEqual([{ x: 30, y: 0 }]);
});

const left = { x: 0, y: 0, width: 100, height: 50 };

test("a right-angle arrow leaves the side square to it, even when the cards are close", () => {
  // Цель чуть правее и ниже: раньше путь шёл вдоль стороны, теперь — наружу и навстречу.
  const right = { x: 130, y: 30, width: 100, height: 50 };
  const path = orthogonal(
    { point: { x: 100, y: 25 }, box: left, side: "right" },
    { point: { x: 130, y: 55 }, box: right, side: "left" },
  );
  expect(path[0]).toEqual({ x: 100, y: 25 });
  expect(path[1]?.y).toBe(25);
  expect(path[1]?.x).toBeGreaterThan(100);
  expect(path.at(-2)?.y).toBe(55);
  expect(path.at(-1)).toEqual({ x: 130, y: 55 });
});

test("a right-angle arrow goes around its own cards instead of through them", () => {
  // Выход вправо, а цель слева: путь огибает свою карточку, а не режет её.
  const far = { x: -200, y: 0, width: 100, height: 50 };
  const path = orthogonal(
    { point: { x: 100, y: 25 }, box: left, side: "right" },
    { point: { x: -100, y: 25 }, box: far, side: "right" },
  );
  const segments = path.slice(1).map((point, i) => [path[i] ?? point, point] as const);
  expect(segments.some(([p, q]) => crosses(p, q, left) || crosses(p, q, far))).toBe(false);
  expect(segments.every(([p, q]) => p.x === q.x || p.y === q.y)).toBe(true);
});

/** Отрезок по оси заходит внутрь рамки, а не скользит по краю. */
function crosses(p: Point, q: Point, box: Box): boolean {
  return (
    Math.max(p.x, q.x) > box.x &&
    Math.min(p.x, q.x) < box.x + box.width &&
    Math.max(p.y, q.y) > box.y &&
    Math.min(p.y, q.y) < box.y + box.height
  );
}

test("a right-angle arrow passes through bends set by hand", () => {
  const bend = { x: 300, y: 300 };
  const path = orthogonal(
    { point: { x: 100, y: 25 }, box: left, side: "right" },
    { point: { x: 500, y: 25 } },
    [bend],
  );
  expect(path).toContainEqual(bend);
});

test("a floating end faces the other card along the longer axis", () => {
  expect(facing(left, { x: 400, y: 60 })).toBe("right");
  expect(facing(left, { x: 60, y: -300 })).toBe("top");
  expect(sideOf(left, { x: 100, y: 10 })).toBe("right");
  expect(sideMiddle(left, "bottom")).toEqual({ x: 50, y: 50 });
});
