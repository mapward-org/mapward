import { expect, test } from "vitest";
import { editSources, planEdit, slug } from "./map-edit.ts";
import type { EditContext, FileChange } from "./map-edit.ts";
import type { MapMetric, MapObject } from "./model.ts";

const object = (address: string, name: string, extra: Partial<MapObject> = {}): MapObject =>
  ({
    address,
    path: `/map/${address.replace("mapward://", "")}`.replace(/\/$/, ""),
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

const viewMetric: MapMetric = {
  key: "canvas",
  address: "mapward://_metrics/canvas",
  configPath: "/map/_metrics/canvas/config.json",
  cachePath: "/map/_metrics/canvas",
  layers: [],
  config: {
    collectors: [
      {
        kind: "objects-map",
        show: ["systems/*"],
        palette: { objects: ["mapward://prototypes/service"], relations: [] },
        placeObjects: "mapward://systems",
        placeRelations: "mapward://relations",
      },
    ],
  },
};

const map = object("mapward://", "Карта", {
  metrics: [viewMetric],
  children: [
    object("mapward://prototypes", "prototypes", {
      isGroup: true,
      children: [object("mapward://prototypes/service", "Сервис")],
    }),
    object("mapward://systems", "systems", {
      isGroup: true,
      children: [
        object("mapward://systems/shop", "Магазин", {
          children: [object("mapward://systems/shop/cart", "Корзина")],
        }),
        object("mapward://systems/bank", "Банк"),
      ],
    }),
    object("mapward://relations", "relations", {
      isGroup: true,
      children: [
        object("mapward://relations/cart-to-bank", "зовёт", {
          props: { from: "mapward://systems/shop/cart", to: "mapward://systems/bank" },
        }),
      ],
    }),
  ],
});

const files = new Map<string, string>([
  ["/map/systems/shop/_index.json", '{ "name": "Магазин" }\n'],
  [
    "/map/systems/shop/cart/_index.json",
    '{ "name": "Корзина", "extends": "mapward://prototypes/service" }\n',
  ],
  ["/map/systems/bank/_index.json", '{ "name": "Банк" }\n'],
  [
    "/map/relations/cart-to-bank/_index.json",
    '{ "name": "зовёт", "props": { "from": "mapward://systems/shop/cart", "to": "mapward://systems/bank" } }\n',
  ],
  [
    "/map/_metrics/canvas/map-state.json",
    JSON.stringify({
      positions: { "mapward://systems/shop/cart": { x: 1, y: 2 } },
      refs: ["mapward://systems/shop/cart"],
    }),
  ],
]);

const context: EditContext = { root: map, files };

const changes = (plan: ReturnType<typeof planEdit>): FileChange[] => {
  if ("error" in plan) throw new Error(plan.error);
  return plan.changes;
};

const written = (list: FileChange[], path: string) => {
  const change = list.find((item) => item.kind === "write" && item.path === path);
  return change?.kind === "write" ? change.text : undefined;
};

test("the sources are every index, own metric config and view state", () => {
  const sources = editSources(map);
  expect(sources).toContain("/map/systems/shop/cart/_index.json");
  expect(sources).toContain("/map/_metrics/canvas/config.json");
  expect(sources).toContain("/map/_metrics/canvas/map-state.json");
  expect(sources.some((path) => path.startsWith("/map/systems/_index"))).toBe(false);
});

test("a folder name keeps any alphabet and drops the rest", () => {
  expect(slug("  Сервис заказов!  ")).toBe("сервис-заказов");
  expect(slug("???")).toBe("объект");
});

test("moving an object moves its folder and rewrites every address that named it", () => {
  const list = changes(
    planEdit(context, {
      op: "move-object",
      object: "mapward://systems/shop/cart",
      parent: "mapward://systems/bank",
      view: "mapward://_metrics/canvas",
      position: { x: 9, y: 9 },
    }),
  );
  expect(list[0]).toEqual({
    kind: "move",
    from: "/map/systems/shop/cart",
    to: "/map/systems/bank/cart",
  });
  expect(written(list, "/map/relations/cart-to-bank/_index.json")).toContain(
    '"from": "mapward://systems/bank/cart"',
  );
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.refs).toEqual(["mapward://systems/bank/cart"]);
  expect(state.positions["mapward://systems/bank/cart"]).toEqual({ x: 9, y: 9 });
  // Адрес магазина тот же префикс не задевает: `systems/shop` ≠ `systems/shop/cart`.
  expect(written(list, "/map/systems/shop/_index.json")).toBeUndefined();
});

test("an object cannot go inside itself, nor onto a taken name", () => {
  expect(
    planEdit(context, {
      op: "move-object",
      object: "mapward://systems/shop",
      parent: "mapward://systems/shop/cart",
    }),
  ).toEqual({ error: "Объект нельзя перенести внутрь самого себя" });
  const clash = planEdit(context, {
    op: "move-object",
    object: "mapward://systems/bank",
    parent: "mapward://systems/shop",
  });
  expect("error" in clash).toBe(false);
});

test("creating on empty space goes to the configured place, with the palette's prototype", () => {
  const list = changes(
    planEdit(context, {
      op: "create-object",
      view: "mapward://_metrics/canvas",
      name: "Склад",
      position: { x: 3, y: 4 },
    }),
  );
  expect(JSON.parse(written(list, "/map/systems/склад/_index.json") ?? "{}")).toEqual({
    name: "Склад",
    extends: "mapward://prototypes/service",
  });
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.positions["mapward://systems/склад"]).toEqual({ x: 3, y: 4 });
});

test("a relation lands in the configured shelf with its ends in props", () => {
  const list = changes(
    planEdit(context, {
      op: "create-relation",
      view: "mapward://_metrics/canvas",
      from: "mapward://systems/bank",
      to: "mapward://systems/shop",
    }),
  );
  expect(JSON.parse(written(list, "/map/relations/bank-to-shop/_index.json") ?? "{}")).toEqual({
    name: "связь",
    props: { from: "mapward://systems/bank", to: "mapward://systems/shop" },
  });
});

test("deleting an object takes its relations along and forgets it in every view", () => {
  const list = changes(
    planEdit(context, { op: "delete-object", object: "mapward://systems/shop" }),
  );
  expect(list).toContainEqual({ kind: "remove", path: "/map/systems/shop" });
  expect(list).toContainEqual({ kind: "remove", path: "/map/relations/cart-to-bank" });
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.refs).toEqual([]);
  expect(state.positions).toEqual({});
});

test("rename writes the name and never renames the folder", () => {
  const list = changes(
    planEdit(context, { op: "rename", object: "mapward://systems/bank", label: "Банк-партнёр" }),
  );
  expect(list).toHaveLength(1);
  expect(JSON.parse(written(list, "/map/systems/bank/_index.json") ?? "{}").name).toBe(
    "Банк-партнёр",
  );
});

test("a view without a place for new objects refuses to create on empty space", () => {
  const bare = object("mapward://", "Карта", {
    metrics: [{ ...viewMetric, config: { collectors: [{ kind: "objects-map" }] } }],
    children: [],
  });
  const plan = planEdit(
    { root: bare, files: new Map() },
    { op: "create-object", view: "mapward://_metrics/canvas", name: "X" },
  );
  expect("error" in plan).toBe(true);
});

test("an object carried out onto the canvas stays on it as a ref when the view does not pick it", () => {
  const list = changes(
    planEdit(context, {
      op: "move-object",
      object: "mapward://systems/shop/cart",
      parent: "mapward://",
      view: "mapward://_metrics/canvas",
    }),
  );
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.refs).toEqual(["mapward://cart"]);
});
