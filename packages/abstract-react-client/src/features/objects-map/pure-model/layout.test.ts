import { expect, test } from "vitest";
import type { ViewNode } from "@mapward/core";
import { absolute, layout, PAD, SIMPLE } from "./layout.ts";

const node = (id: string, extra: Partial<ViewNode> = {}): ViewNode => ({
  id,
  kind: "object",
  label: id,
  link: id,
  object: id,
  shape: "rect",
  view: "simple",
  expandable: false,
  expanded: false,
  ...extra,
});

test("a group stretches around its residents, and the residents sit inside its padding", () => {
  const boxes = layout({
    nodes: [
      node("g", { expandable: true, expanded: true, position: { x: 100, y: 100 } }),
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
