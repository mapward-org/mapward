import { expect, test } from "vitest";
import { dropOp, dropTarget, parentAddress, type Rect } from "./drop.ts";

const shop: Rect = { id: "mapward://systems/shop", x: 0, y: 0, width: 400, height: 300 };
const bank: Rect = { id: "mapward://systems/bank", x: 380, y: 0, width: 300, height: 300 };
const cart: Rect = { id: "mapward://systems/shop/cart", x: 20, y: 40, width: 150, height: 100 };

test("no sticky border: where frames overlap, the smaller one under the centre takes the node", () => {
  // Центр в полосе, где рамки Магазина и Банка перекрываются; Банк меньше.
  const target = dropTarget({
    node: "mapward://systems/shop/orders",
    center: { x: 390, y: 150 },
    groups: [shop, bank],
  });
  expect(target).toBe(bank.id);
});

test("once the centre leaves the own group, the node falls into the group under it", () => {
  const target = dropTarget({
    node: "mapward://systems/shop/orders",
    center: { x: 500, y: 150 },
    groups: [shop, bank],
  });
  expect(target).toBe(bank.id);
});

test("inside the own group a deeper group takes the node", () => {
  const target = dropTarget({
    node: "mapward://systems/shop/orders",
    center: { x: 60, y: 80 },
    groups: [shop, bank, cart],
  });
  expect(target).toBe(cart.id);
});

test("a node never falls into itself or its residents", () => {
  const target = dropTarget({
    node: "mapward://systems/shop",
    center: { x: 60, y: 80 },
    groups: [shop, cart],
  });
  expect(target).toBeUndefined();
});

test("outside every group the node lands on the canvas", () => {
  expect(
    dropTarget({
      node: "mapward://x",
      center: { x: 900, y: 900 },
      groups: [shop],
    }),
  ).toBeUndefined();
});

test("staying where it was is only a shift; a ref never moves its folder", () => {
  const base = {
    view: "v",
    node: "mapward://systems/shop/orders",
    position: { x: 1, y: 1 },
    stay: { x: 5, y: 5 },
  };
  expect(dropOp({ ...base, kind: "object", parent: shop.id, target: shop.id })).toEqual({
    op: "move-nodes",
    view: "v",
    positions: { "mapward://systems/shop/orders": { x: 5, y: 5 } },
  });
  expect(dropOp({ ...base, kind: "ref", parent: undefined, target: bank.id }).op).toBe(
    "move-nodes",
  );
});

test("into another group the folder moves; out onto the canvas it goes to the old group's parent", () => {
  const base = {
    view: "v",
    node: "mapward://systems/shop/orders",
    kind: "object" as const,
    position: { x: 1, y: 2 },
    stay: { x: 0, y: 0 },
  };
  expect(dropOp({ ...base, parent: shop.id, target: bank.id })).toEqual({
    op: "move-object",
    view: "v",
    object: "mapward://systems/shop/orders",
    parent: bank.id,
    position: { x: 1, y: 2 },
  });
  expect(dropOp({ ...base, parent: shop.id, target: undefined })).toMatchObject({
    op: "move-object",
    parent: "mapward://systems",
  });
  expect(parentAddress("mapward://apps")).toBe("mapward://");
});
