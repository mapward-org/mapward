import { expect, test } from "vitest";
import { corners, handles, routePath } from "./route.ts";

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
