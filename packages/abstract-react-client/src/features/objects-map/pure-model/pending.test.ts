import { expect, test } from "vitest";
import type { ObjectsMap, ViewNode } from "@mapward/core";
import { overlay, pendingId, reflected } from "./pending.ts";
import type { PendingEdit } from "./pending.ts";
import { editOps, lineEnd, withDraft } from "./edit.ts";

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

const map: ObjectsMap = {
  view: "v",
  nodes: [
    node("mapward://shop", { expandable: true, expanded: true }),
    node("mapward://shop/cart", { parent: "mapward://shop", position: { x: 1, y: 1 } }),
    node("mapward://bank"),
  ],
  relations: [
    { id: "r", from: "mapward://shop/cart", to: "mapward://bank", count: 1, relations: [] },
  ],
  shapes: [{ id: "s", kind: "rect", x: 0, y: 0 }],
  palette: { objects: [], relations: [] },
  canPlaceObjects: true,
  canPlaceRelations: true,
};

const entry = (ops: PendingEdit["ops"], extra: Partial<PendingEdit> = {}): PendingEdit => ({
  key: 1,
  ops,
  sent: map,
  ...extra,
});

test("moved nodes stand where they were dropped before the server answers", () => {
  const picture = overlay(map, [
    entry([{ op: "move-nodes", view: "v", positions: { "mapward://bank": { x: 9, y: 9 } } }]),
  ]);
  expect(picture.nodes.find((n) => n.id === "mapward://bank")?.position).toEqual({ x: 9, y: 9 });
});

test("an object carried into a group is drawn inside it at once", () => {
  const picture = overlay(map, [
    entry([
      {
        op: "move-object",
        object: "mapward://bank",
        parent: "mapward://shop",
        position: { x: 3, y: 4 },
      },
    ]),
  ]);
  expect(picture.nodes.find((n) => n.id === "mapward://bank")).toMatchObject({
    parent: "mapward://shop",
    position: { x: 3, y: 4 },
  });
});

test("a deleted object takes its residents and arrows off the canvas", () => {
  const picture = overlay(map, [entry([{ op: "delete-object", object: "mapward://shop" }])]);
  expect(picture.nodes.map((n) => n.id)).toEqual(["mapward://bank"]);
  expect(picture.relations).toEqual([]);
});

test("a created object shows under a temporary id, named, where it was dropped", () => {
  const picture = overlay(map, [
    entry([{ op: "create-object", view: "v", name: "Склад", position: { x: 5, y: 5 } }], {
      key: 7,
    }),
  ]);
  expect(picture.nodes.at(-1)).toMatchObject({ id: pendingId(7, 0), label: "Склад" });
});

test("rename, fold and shapes apply as sent", () => {
  const picture = overlay(map, [
    entry([
      { op: "rename", object: "mapward://bank", label: "Банк" },
      { op: "set-expanded", view: "v", object: "mapward://shop", expanded: false },
      { op: "put-shape", view: "v", shape: { id: "s", kind: "rect", x: 0, y: 0, width: 300 } },
    ]),
  ]);
  expect(picture.nodes.find((n) => n.id === "mapward://bank")?.label).toBe("Банк");
  expect(picture.nodes.some((n) => n.id === "mapward://shop/cart")).toBe(false);
  expect(picture.shapes[0]?.width).toBe(300);
});

test("an edit leaves only when the value reflects it, not on any new snapshot", () => {
  const edit = entry([
    { op: "move-nodes", view: "v", positions: { "mapward://bank": { x: 9, y: 9 } } },
  ]);
  // Снимок с тем же старым содержимым — новый объект, но правку он не отражает.
  const stale = { ...map, nodes: [...map.nodes] };
  expect(reflected(stale, edit)).toBe(false);
  expect(overlay(stale, [edit]).nodes.at(-1)?.position).toEqual({ x: 9, y: 9 });
  const fresh = {
    ...map,
    nodes: map.nodes.map((n) =>
      n.id === "mapward://bank" ? { ...n, position: { x: 9.3, y: 9 } } : n,
    ),
  };
  expect(reflected(fresh, edit)).toBe(true);
  expect(overlay(fresh, [edit])).toBe(fresh);
});

test("a move and a new address are reflected by the node under its new address", () => {
  const moved = entry([
    { op: "move-object", object: "mapward://bank", parent: "mapward://shop" },
    { op: "set-folder", object: "mapward://shop/cart", folder: "Корзина" },
  ]);
  expect(reflected(map, moved)).toBe(false);
  const after = {
    ...map,
    nodes: [node("mapward://shop"), node("mapward://shop/bank"), node("mapward://shop/корзина")],
  };
  expect(reflected(after, moved)).toBe(true);
});

test("sizes and bends are drawn at once and reflected when they match", () => {
  const edit = entry([
    { op: "resize-nodes", view: "v", sizes: { "mapward://bank": { width: 400, height: 300 } } },
    { op: "set-bends", view: "v", arrow: "r", bends: [{ x: 5, y: 5 }] },
  ]);
  const picture = overlay(map, [edit]);
  expect(picture.nodes.find((n) => n.id === "mapward://bank")?.size).toEqual({
    width: 400,
    height: 300,
  });
  expect(picture.relations[0]?.bends).toEqual([{ x: 5, y: 5 }]);
  expect(reflected(picture, edit)).toBe(true);
});

test("a draft is a node without an address, inside the group it was dropped on", () => {
  const picture = withDraft(map, {
    prototype: "p",
    parent: "mapward://shop",
    position: { x: 0, y: 0 },
  });
  expect(picture.nodes.at(-1)).toMatchObject({ id: "draft:new", parent: "mapward://shop" });
});

test("a line end sticks to what is under it, never to the line itself", () => {
  expect(lineEnd({ x: 1, y: 2 }, "mapward://bank")).toEqual({ node: "mapward://bank" });
  expect(lineEnd({ x: 1, y: 2 }, undefined)).toEqual({ x: 1, y: 2 });
  expect(lineEnd({ x: 1, y: 2 }, "l1", "l1")).toEqual({ x: 1, y: 2 });
});

test("the dialog sends only what changed", () => {
  const editing = { address: "mapward://bank", name: "bank", folder: "bank" };
  expect(editOps("v", editing, "bank", "bank")).toEqual([]);
  expect(editOps("v", editing, " Банк ", "bank")).toEqual([
    { op: "rename", object: "mapward://bank", label: "Банк", view: "v" },
  ]);
});

test("an arrow style is drawn at once and reflected when the whole style matches", () => {
  const edit = entry([
    {
      op: "style-arrow",
      view: "v",
      arrow: "r",
      style: { stroke: "#f00", route: "rounded", fromAnchor: { x: 1, y: 0.5 } },
    },
  ]);
  const picture = overlay(map, [edit]);
  expect(picture.relations[0]?.style).toEqual({
    stroke: "#f00",
    route: "rounded",
    fromAnchor: { x: 1, y: 0.5 },
  });
  expect(reflected(map, edit)).toBe(false);
  expect(reflected(picture, edit)).toBe(true);
});

test("a draft and a created object take the colour of their prototype from the palette", () => {
  const colored = {
    ...map,
    palette: {
      objects: [{ prototype: "p", label: "Событие", color: "#ff9f43", textColor: "#1e1e1e" }],
      relations: [],
    },
  };
  expect(
    withDraft(colored, { prototype: "p", position: { x: 0, y: 0 } }).nodes.at(-1),
  ).toMatchObject({ color: "#ff9f43", textColor: "#1e1e1e" });
  const picture = overlay(colored, [
    entry([{ op: "create-object", view: "v", name: "Оплачено", prototype: "p" }]),
  ]);
  expect(picture.nodes.at(-1)).toMatchObject({ color: "#ff9f43", textColor: "#1e1e1e" });
});
