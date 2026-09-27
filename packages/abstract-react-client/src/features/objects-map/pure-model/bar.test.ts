import { expect, test } from "vitest";
import type { ViewNode, ViewRelation, ViewShape } from "@mapward/core";
import { barFor, lookOf, patchFor, railObjects, remember, stepped } from "./bar.ts";

const shape = (kind: ViewShape["kind"], extra: Partial<ViewShape> = {}): ViewShape => ({
  id: "s",
  kind,
  x: 0,
  y: 0,
  ...extra,
});
const arrow = (count: number): ViewRelation => ({
  id: "a",
  from: "x",
  to: "y",
  count,
  relations: [],
  style: { stroke: "#f00", strokeWidth: 2 },
});
const node = { id: "n" } as ViewNode;

test("the bar shows only what applies to the selected kind", () => {
  expect(barFor({ kind: "object", node })).toEqual(["edit", "dive", "|", "delete"]);
  expect(barFor({ kind: "shape", shape: shape("line") })).toContain("arrows");
  expect(barFor({ kind: "shape", shape: shape("rect") })).not.toContain("arrows");
  expect(barFor({ kind: "shape", shape: shape("text") })).not.toContain("width");
  // Склеенную стрелку одной кнопкой не удалить.
  expect(barFor({ kind: "arrow", arrow: arrow(2) })).not.toContain("delete");
  expect(barFor({ kind: "arrow", arrow: arrow(1) })).toContain("delete");
});

test("the look marks buttons with the current style, shape and arrow alike", () => {
  expect(
    lookOf({ kind: "shape", shape: shape("rect", { color: "#0f0", strokeWidth: 3 }) }),
  ).toMatchObject({
    fill: "#0f0",
    width: 3,
  });
  expect(lookOf({ kind: "arrow", arrow: arrow(1) })).toMatchObject({ stroke: "#f00", width: 2 });
});

test("a menu value lands in the field of its kind", () => {
  expect(patchFor({ kind: "shape", shape: shape("rect") }, "fill", "#0f0")).toEqual({
    color: "#0f0",
  });
  expect(patchFor({ kind: "shape", shape: shape("line") }, "width", 4)).toEqual({ strokeWidth: 4 });
  expect(patchFor({ kind: "arrow", arrow: arrow(1) }, "width", 4)).toEqual({ strokeWidth: 4 });
});

test("recent colours keep the fresh one first, without repeats", () => {
  expect(remember(["#a", "#b"], "#b")).toEqual(["#b", "#a"]);
  expect(remember([], undefined)).toEqual([]);
});

test("the rail shows six prototypes and hides the rest behind plus", () => {
  const palette = Array.from({ length: 8 }, (_, i) => ({ prototype: `p${i}`, label: `${i}` }));
  const { shown, more } = railObjects(palette);
  expect(shown).toHaveLength(6);
  expect(more.map((item) => item.prototype)).toEqual(["p6", "p7"]);
});

test("a stepper stays within bounds", () => {
  expect(stepped(10, 2, 6, 96, 11)).toBe(12);
  expect(stepped(undefined, -1, 6, 96, 11)).toBe(10);
  expect(stepped(96, 1, 6, 96, 11)).toBe(96);
});
