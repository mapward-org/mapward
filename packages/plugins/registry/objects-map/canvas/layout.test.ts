import { expect, test } from "vitest";
import type { ViewNode } from "../model/types.ts";
import { absolute, layout, PAD, pinnedEnds, ROOM, SIMPLE } from "./layout.ts";

const node = (id: string, extra: Partial<ViewNode> = {}): ViewNode => ({
  id,
  kind: "object",
  label: id,
  link: id,
  object: id,
  shape: "rect",
  view: "simple",
  expanded: false,
  ...extra,
});

test("a group stretches around its residents, and the residents sit inside its padding", () => {
  const boxes = layout({
    nodes: [
      node("g", { expanded: true, position: { x: 100, y: 100 } }),
      node("g/a", { parent: "g" }),
      node("g/b", { parent: "g", position: { x: 300, y: 200 } }),
    ],
  });
  const [group, a, b] = boxes;
  expect(a?.position).toEqual({ x: PAD.side, y: PAD.top });
  expect(b?.position).toEqual({ x: 300, y: 200 });
  expect(group?.width).toBe(300 + SIMPLE.width + PAD.side);
  expect(group?.height).toBe(200 + SIMPLE.height + PAD.side);
  expect(absolute(boxes, "g/b")).toEqual({ x: 400, y: 300 });
});

test("a node without a saved position falls into a row of three", () => {
  const boxes = layout({ nodes: [node("a"), node("b"), node("c"), node("d")] });
  expect(boxes[3]?.position.x).toBe(0);
  expect(boxes[3]?.position.y).toBeGreaterThan(0);
});

test("an empty group is a room to drop into, a stretched one keeps its size", () => {
  const [empty, stretched] = layout({
    nodes: [
      node("g", { expanded: true }),
      node("h", { expanded: true, size: { width: 600, height: 400 } }),
    ],
  });
  expect(empty).toMatchObject(ROOM);
  expect(stretched).toMatchObject({ width: 600, height: 400 });
});

test("a stretched frame keeps its size even when a resident sticks out", () => {
  const [frame] = layout({
    nodes: [
      node("g", { expanded: true, size: { width: 200, height: 120 } }),
      node("g/a", { parent: "g", position: { x: 300, y: 200 } }),
    ],
  });
  expect(frame).toMatchObject({ width: 200, height: 120 });
});

test("a new arrow is pinned: a named side as given, the other one facing the other node", () => {
  const map = {
    nodes: [
      node("shop", { position: { x: 0, y: 0 } }),
      node("bank", { position: { x: 400, y: 0 } }),
    ],
  };
  expect(pinnedEnds(map, "bank", "shop", { from: "bottom" })).toEqual({
    fromAnchor: { x: 0.5, y: 1 },
    toAnchor: { x: 1, y: 0.5 },
  });
  expect(pinnedEnds(map, "bank", "nowhere")).toBeUndefined();
});
