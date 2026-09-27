import { expect, test } from "vitest";
import { objectsMap, objectsMapConfig } from "./objects-map.ts";
import type { MapObject } from "./model.ts";

const object = (address: string, name: string, extra: Partial<MapObject> = {}): MapObject =>
  ({
    address,
    path: `/map/${address.replace("mapward://", "")}`,
    name,
    isGroup: false,
    props: {},
    layers: [],
    metrics: [],
    directives: [],
    actions: [],
    workflow: [],
    metricGroups: [],
    children: [],
    ...extra,
  }) as MapObject;

const service = (address: string, name: string) =>
  object(address, name, {
    prototypeName: "Сервис",
    layers: [
      { address, path: "", from: "own" },
      { address: "mapward://prototypes/service", path: "", from: "prototype" },
    ],
  });

const relation = (address: string, from: string, to: string) =>
  object(address, "зовёт", { props: { from, to } });

const map = object("mapward://", "Карта", {
  children: [
    object("mapward://systems", "systems", {
      isGroup: true,
      children: [
        object("mapward://systems/shop", "Магазин", {
          children: [
            service("mapward://systems/shop/cart", "Корзина"),
            service("mapward://systems/shop/orders", "Заказы"),
          ],
        }),
        object("mapward://systems/bank", "Банк", {
          props: { title: "Банк-партнёр" },
          children: [service("mapward://systems/bank/pay", "Платежи")],
        }),
      ],
    }),
    object("mapward://relations", "relations", {
      isGroup: true,
      children: [
        relation(
          "mapward://relations/a",
          "mapward://systems/shop/cart",
          "mapward://systems/bank/pay",
        ),
        relation(
          "mapward://relations/b",
          "mapward://systems/shop/orders",
          "mapward://systems/bank/pay",
        ),
        relation(
          "mapward://relations/c",
          "mapward://systems/shop/cart",
          "mapward://systems/shop/orders",
        ),
      ],
    }),
  ],
});

const config = (spec: Record<string, unknown>) => objectsMapConfig(spec);

test("shows only what the metric names, shelves and relations never become nodes", () => {
  const value = objectsMap(map, "v", config({ show: ["systems/*"] }), {});
  expect(value.nodes.map((node) => node.id)).toEqual([
    "mapward://systems/shop",
    "mapward://systems/bank",
  ]);
});

test("a collapsed group takes the arrows of its residents, and pairs glue into one", () => {
  const value = objectsMap(map, "v", config({ show: ["systems/*"] }), {});
  expect(value.relations).toHaveLength(1);
  const [arrow] = value.relations;
  expect(arrow?.from).toBe("mapward://systems/shop");
  expect(arrow?.to).toBe("mapward://systems/bank");
  expect(arrow?.count).toBe(2);
  expect(arrow?.link).toBeUndefined();
  expect(arrow?.relations.map((item) => item.link)).toEqual([
    "mapward://relations/a",
    "mapward://relations/b",
  ]);
});

test("an expanded group draws its residents inside, and arrows land on them", () => {
  const value = objectsMap(
    map,
    "v",
    config({ show: ["systems/*"], expand: { objects: ["systems/shop"] } }),
    {},
  );
  const cart = value.nodes.find((node) => node.id === "mapward://systems/shop/cart");
  expect(cart?.parent).toBe("mapward://systems/shop");
  expect(value.nodes.find((node) => node.id === "mapward://systems/shop")?.expanded).toBe(true);
  // Корзина → Заказы внутри одной группы и две стрелки в свёрнутый Банк.
  expect(value.relations.map((arrow) => `${arrow.from} ${arrow.to} ${arrow.count}`)).toEqual([
    "mapward://systems/shop/cart mapward://systems/bank 1",
    "mapward://systems/shop/orders mapward://systems/bank 1",
    "mapward://systems/shop/cart mapward://systems/shop/orders 1",
  ]);
});

test("a hand-folded group beats the config", () => {
  const value = objectsMap(
    map,
    "v",
    config({ show: ["systems/*"], expand: { objects: ["systems/*"] } }),
    { expanded: { "mapward://systems/bank": false } },
  );
  expect(value.nodes.find((node) => node.id === "mapward://systems/bank")?.expanded).toBe(false);
  expect(value.nodes.some((node) => node.id === "mapward://systems/bank/pay")).toBe(false);
});

test("prototypes pick objects anywhere, and a style narrows field by field", () => {
  const value = objectsMap(
    map,
    "v",
    config({
      prototypes: ["Сервис"],
      style: {
        all: { shape: "rect", view: "simple" },
        prototypes: { "mapward://prototypes/service": { color: "#0a0", shape: "round" } },
        objects: { "systems/shop/cart": { view: "preview" } },
      },
    }),
    {},
  );
  const cart = value.nodes.find((node) => node.id === "mapward://systems/shop/cart");
  expect(cart).toMatchObject({ shape: "round", color: "#0a0", view: "preview" });
  const pay = value.nodes.find((node) => node.id === "mapward://systems/bank/pay");
  expect(pay).toMatchObject({ shape: "round", view: "simple" });
});

test("the label comes from props when the style names a field", () => {
  const value = objectsMap(
    map,
    "v",
    config({ show: ["systems/bank"], style: { all: { label: "title" } } }),
    {},
  );
  expect(value.nodes[0]?.label).toBe("Банк-партнёр");
});

test("refs from the state join the canvas, positions and shapes ride along", () => {
  const value = objectsMap(map, "v", config({ show: ["systems/shop"] }), {
    refs: ["mapward://systems/bank/pay"],
    positions: { "mapward://systems/bank/pay": { x: 5, y: 7 } },
    shapes: [{ id: "s", kind: "text", x: 0, y: 0, text: "заметка" }],
  });
  const pay = value.nodes.find((node) => node.id === "mapward://systems/bank/pay");
  expect(pay).toMatchObject({ kind: "ref", position: { x: 5, y: 7 } });
  expect(value.shapes).toHaveLength(1);
  expect(value.relations.map((arrow) => `${arrow.from} ${arrow.to} ${arrow.count}`)).toEqual([
    "mapward://systems/shop mapward://systems/bank/pay 2",
  ]);
});

test("an arrow whose end is off the canvas is not drawn", () => {
  const value = objectsMap(map, "v", config({ show: ["systems/shop"] }), {});
  expect(value.relations).toHaveLength(0);
});

test("hand sizes and bends from the state reach the nodes and arrows", () => {
  const value = objectsMap(map, "v", config({ show: ["systems/*"] }), {
    sizes: { "mapward://systems/shop": { width: 500, height: 320 } },
    bends: { "mapward://systems/shop→mapward://systems/bank": [{ x: 3, y: 4 }] },
  });
  expect(value.nodes.find((node) => node.id === "mapward://systems/shop")?.size).toEqual({
    width: 500,
    height: 320,
  });
  expect(value.relations[0]?.bends).toEqual([{ x: 3, y: 4 }]);
});

test("a label reads on its card, and a palette button wears its prototype's colour", () => {
  const value = objectsMap(
    map,
    "v",
    config({
      prototypes: ["Сервис"],
      style: { prototypes: { "mapward://prototypes/service": { color: "#ff9f43" } } },
      palette: { objects: ["mapward://prototypes/service"] },
    }),
    {},
  );
  expect(value.nodes[0]?.textColor).toBe("#1f1f1f");
  expect(value.palette.objects[0]).toMatchObject({ color: "#ff9f43", textColor: "#1f1f1f" });
});
