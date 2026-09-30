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

test("a frame drawn by dragging is created with the size it was drawn", () => {
  const list = changes(
    planEdit(context, {
      op: "create-object",
      view: "mapward://_metrics/canvas",
      name: "Оплата",
      position: { x: 0, y: 0 },
      size: { width: 420, height: 260 },
    }),
  );
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.sizes["mapward://systems/оплата"]).toEqual({ width: 420, height: 260 });
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

test("a new address renames the folder in place and rewrites the addresses", () => {
  const list = changes(
    planEdit(context, {
      op: "set-folder",
      object: "mapward://systems/bank",
      folder: "Банк партнёр",
    }),
  );
  expect(list[0]).toEqual({
    kind: "move",
    from: "/map/systems/bank",
    to: "/map/systems/банк-партнёр",
  });
  expect(written(list, "/map/relations/cart-to-bank/_index.json")).toContain(
    '"to": "mapward://systems/банк-партнёр"',
  );
});

test("a new address cannot take a sibling's name", () => {
  const plan = planEdit(context, {
    op: "set-folder",
    object: "mapward://systems/bank",
    folder: "shop",
  });
  expect(plan).toEqual({ error: "В systems уже есть shop" });
});

test("a line is a shape with ends, and its style rides in the view state", () => {
  const list = changes(
    planEdit(context, {
      op: "put-shape",
      view: "mapward://_metrics/canvas",
      shape: {
        id: "l1",
        kind: "line",
        x: 0,
        y: 0,
        from: { node: "mapward://systems/bank" },
        to: { x: 10, y: 20 },
        arrow: "end",
        stroke: "#333",
      },
    }),
  );
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.shapes[0]).toMatchObject({ kind: "line", from: { node: "mapward://systems/bank" } });
});

test("a stretched preview and a bent arrow are remembered by the view", () => {
  const sized = changes(
    planEdit(context, {
      op: "resize-nodes",
      view: "mapward://_metrics/canvas",
      sizes: { "mapward://systems/bank": { width: 400, height: 300 } },
    }),
  );
  const state = JSON.parse(written(sized, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.sizes["mapward://systems/bank"]).toEqual({ width: 400, height: 300 });

  const bent = changes(
    planEdit(context, {
      op: "set-bends",
      view: "mapward://_metrics/canvas",
      arrow: "a→b",
      bends: [{ x: 1, y: 2 }],
    }),
  );
  const next = JSON.parse(written(bent, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(next.bends["a→b"]).toEqual([{ x: 1, y: 2 }]);
});

test("an arrow keeps its own style on this view", () => {
  const list = changes(
    planEdit(context, {
      op: "style-arrow",
      view: "mapward://_metrics/canvas",
      arrow: "a→b",
      style: { stroke: "#f00", strokeWidth: 3, fontSize: 16, route: "orthogonal" },
    }),
  );
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.arrows["a→b"]).toEqual({
    stroke: "#f00",
    strokeWidth: 3,
    fontSize: 16,
    route: "orthogonal",
  });
});

test("a copy takes the object with its children, under a free folder, and keeps the prototype", () => {
  const list = changes(
    planEdit(context, {
      op: "copy-objects",
      view: "mapward://_metrics/canvas",
      objects: ["mapward://systems/shop"],
    }),
  );
  expect(written(list, "/map/systems/shop-2/_index.json")).toContain('"Магазин"');
  expect(written(list, "/map/systems/shop-2/cart/_index.json")).toContain(
    '"extends": "mapward://prototypes/service"',
  );
  // Оригинал не тронут, связь с концом снаружи копии остаётся у оригинала.
  expect(list.some((item) => item.kind !== "write")).toBe(false);
  expect(
    list.some((item) => item.kind === "write" && item.path.startsWith("/map/relations/")),
  ).toBe(false);
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.positions["mapward://systems/shop-2/cart"]).toEqual({ x: 1, y: 2 });
  expect(state.positions["mapward://systems/shop/cart"]).toEqual({ x: 1, y: 2 });
  // Магазин вьюха выбирает шаблоном `systems/*` — его копия видна и без ссылки.
  expect(state.refs).toEqual(["mapward://systems/shop/cart"]);
});

test("a relation with both ends in the copy is copied onto the copies", () => {
  const list = changes(
    planEdit(context, {
      op: "copy-objects",
      view: "mapward://_metrics/canvas",
      objects: ["mapward://systems/shop", "mapward://systems/bank", "mapward://systems/shop/cart"],
      positions: { "mapward://systems/bank": { x: 5, y: 6 } },
    }),
  );
  const relation = written(list, "/map/relations/cart-to-bank-2/_index.json") ?? "";
  expect(relation).toContain('"from": "mapward://systems/shop-2/cart"');
  expect(relation).toContain('"to": "mapward://systems/bank-2"');
  // Корзина едет вместе с магазином и второй раз не копируется.
  expect(written(list, "/map/systems/cart/_index.json")).toBeUndefined();
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.positions["mapward://systems/bank-2"]).toEqual({ x: 5, y: 6 });
});

test("a copy lands in the named group and stands there as a ref when the view does not pick it", () => {
  const list = changes(
    planEdit(context, {
      op: "copy-objects",
      view: "mapward://_metrics/canvas",
      objects: ["mapward://systems/bank"],
      parent: "mapward://systems/shop",
    }),
  );
  expect(written(list, "/map/systems/shop/bank/_index.json")).toContain('"Банк"');
  const state = JSON.parse(written(list, "/map/_metrics/canvas/map-state.json") ?? "{}");
  expect(state.refs).toContain("mapward://systems/shop/bank");
});

test("a copy of an object deleted after copying is refused", () => {
  const plan = planEdit(context, {
    op: "copy-objects",
    view: "mapward://_metrics/canvas",
    objects: ["mapward://systems/gone"],
  });
  expect("error" in plan && plan.error).toContain("удалили");
});
