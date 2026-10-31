import { expect, test } from "vitest";
import type { MapEditOp, MapMetric, MapObject } from "@mapward/plugin";
import { childAddress, findObject, slug, walk } from "./map.ts";
import type { MapOp } from "./ops.ts";
import { editSources, planEdit } from "./plan.ts";
import type { EditContext, MapDone } from "./plan.ts";
import { viewsOf } from "./view.ts";

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
    component: "/plugins/objects-map/view.tsx",
    params: {
      show: ["systems/*"],
      palette: { objects: ["mapward://prototypes/service"], relations: [] },
      placeObjects: "mapward://systems",
      placeRelations: "mapward://relations",
    },
    agent: { plugin: "/plugins/objects-map", method: "view" },
  },
};

const isView = viewsOf("/plugins/objects-map");

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

const STATE = "/map/_metrics/canvas/map-state.json";
const files = new Map<string, string>([
  [
    STATE,
    JSON.stringify({
      positions: { "mapward://systems/shop/cart": { x: 1, y: 2 } },
      refs: ["mapward://systems/shop/cart"],
    }),
  ],
]);

const context: EditContext = { root: map, files, isView };

/**
 * Подставной `ctx.editMap`: отвечает, как ответила бы платформа, — новые адреса, переезды с
 * потомками и копии под свободным именем. Файлы карты пишет платформа, и её тесты — у сервера;
 * здесь проверяется, что холст попросил и что дописал в своё.
 */
function answer(root: MapObject, ops: MapEditOp[]): MapDone {
  const done: MapDone = { created: [], moves: [], copies: [] };
  const under = (address: string, to: string, list: MapDone["moves"]) =>
    walk(findObject(root, address) ?? root, (inner) =>
      list.push({ from: inner.address, to: to + inner.address.slice(address.length) }),
    );
  const freeIn = (parent: string, wanted: string) => {
    const names = new Set((findObject(root, parent)?.children ?? []).map((c) => c.address));
    let address = childAddress(parent, wanted);
    for (let index = 2; names.has(address); index += 1) {
      address = childAddress(parent, `${wanted}-${index}`);
    }
    return address;
  };
  for (const op of ops) {
    if (op.op === "create") {
      done.created.push(freeIn(op.parent, slug(op.folder ?? String(op.content.name))));
    }
    if (op.op === "move") {
      under(op.object, childAddress(op.parent, op.object.split("/").at(-1) ?? ""), done.moves);
    }
    if (op.op === "setFolder") {
      const parent = op.object.slice(0, op.object.lastIndexOf("/"));
      under(op.object, `${parent}/${slug(op.folder)}`, done.moves);
    }
    if (op.op === "copy") {
      for (const item of op.objects) {
        under(item.object, freeIn(item.parent, item.object.split("/").at(-1) ?? ""), done.copies);
      }
    }
  }
  return done;
}

type Run = { ops: MapEditOp[]; writes: Map<string, string> };

const run = (ctx: EditContext, op: MapOp): Run => {
  const plan = planEdit(ctx, op);
  if ("error" in plan) throw new Error(plan.error);
  return { ops: plan.ops, writes: plan.finish(answer(ctx.root, plan.ops)) };
};

const stateOf = (result: Run, path = STATE) => JSON.parse(result.writes.get(path) ?? "{}");

test("the sources are the states of every view", () => {
  expect(editSources(map, isView)).toEqual([STATE]);
});

test("moving an object asks the platform, then follows the move in the view state", () => {
  const result = run(context, {
    op: "move-object",
    object: "mapward://systems/shop/cart",
    parent: "mapward://systems/bank",
    view: "mapward://_metrics/canvas",
    position: { x: 9, y: 9 },
  });
  expect(result.ops).toEqual([
    { op: "move", object: "mapward://systems/shop/cart", parent: "mapward://systems/bank" },
  ]);
  const state = stateOf(result);
  expect(state.refs).toEqual(["mapward://systems/bank/cart"]);
  expect(state.positions["mapward://systems/bank/cart"]).toEqual({ x: 9, y: 9 });
  expect(state.positions["mapward://systems/shop/cart"]).toBeUndefined();
});

test("a view state inside a moved object is written where it now lies", () => {
  const inside = object("mapward://systems/shop", "Магазин", {
    metrics: [
      {
        ...viewMetric,
        address: "mapward://systems/shop/_metrics/canvas",
        cachePath: "/map/systems/shop/_metrics/canvas",
      },
    ],
  });
  const root = object("mapward://", "Карта", {
    children: [object("mapward://systems", "systems", { isGroup: true, children: [inside] })],
  });
  const path = "/map/systems/shop/_metrics/canvas/map-state.json";
  const result = run(
    {
      root,
      isView,
      files: new Map([[path, JSON.stringify({ refs: ["mapward://systems/shop"] })]]),
    },
    { op: "set-folder", object: "mapward://systems/shop", folder: "store" },
  );
  expect([...result.writes.keys()]).toEqual(["/map/systems/store/_metrics/canvas/map-state.json"]);
  expect(stateOf(result, "/map/systems/store/_metrics/canvas/map-state.json").refs).toEqual([
    "mapward://systems/store",
  ]);
});

test("creating on empty space goes to the configured place, with the palette's prototype", () => {
  const result = run(context, {
    op: "create-object",
    view: "mapward://_metrics/canvas",
    name: "Склад",
    position: { x: 3, y: 4 },
  });
  expect(result.ops).toEqual([
    {
      op: "create",
      parent: "mapward://systems",
      content: { name: "Склад", extends: "mapward://prototypes/service" },
    },
  ]);
  expect(stateOf(result).positions["mapward://systems/склад"]).toEqual({ x: 3, y: 4 });
});

test("a frame drawn by dragging is created with the size it was drawn", () => {
  const result = run(context, {
    op: "create-object",
    view: "mapward://_metrics/canvas",
    name: "Оплата",
    position: { x: 0, y: 0 },
    size: { width: 420, height: 260 },
  });
  expect(stateOf(result).sizes["mapward://systems/оплата"]).toEqual({ width: 420, height: 260 });
});

test("a relation is an object the platform creates, with its ends in props", () => {
  const result = run(context, {
    op: "create-relation",
    view: "mapward://_metrics/canvas",
    from: "mapward://systems/bank",
    to: "mapward://systems/shop",
  });
  expect(result.ops).toEqual([
    {
      op: "create",
      parent: "mapward://relations",
      folder: "bank-to-shop",
      content: {
        name: "связь",
        props: { from: "mapward://systems/bank", to: "mapward://systems/shop" },
      },
    },
  ]);
});

test("a new arrow is pinned by the canvas: the visible ends and the named sides go to `pin`", () => {
  const asked: unknown[] = [];
  const result = run(
    {
      ...context,
      pin: (_map, from, to, sides) => {
        asked.push({ from, to, sides });
        return { fromAnchor: { x: 0.5, y: 1 }, toAnchor: { x: 1, y: 0.5 } };
      },
    },
    {
      op: "create-relation",
      view: "mapward://_metrics/canvas",
      from: "mapward://systems/bank",
      to: "mapward://systems/shop",
      fromSide: "bottom",
    },
  );
  expect(asked).toEqual([
    {
      from: "mapward://systems/bank",
      to: "mapward://systems/shop",
      sides: { from: "bottom", to: undefined },
    },
  ]);
  expect(stateOf(result).arrows["mapward://systems/bank→mapward://systems/shop"]).toEqual({
    fromAnchor: { x: 0.5, y: 1 },
    toAnchor: { x: 1, y: 0.5 },
  });

  // Без холста закреплять нечем: концы плавающие, файл вьюхи не тронут.
  const floating = run(context, {
    op: "create-relation",
    view: "mapward://_metrics/canvas",
    from: "mapward://systems/bank",
    to: "mapward://systems/shop",
  });
  expect(floating.writes.size).toBe(0);
});

test("a relation joining an arrow already drawn leaves its ends alone", () => {
  const result = run(
    {
      ...context,
      pin: () => {
        throw new Error("уже нарисованную стрелку не закрепляют");
      },
    },
    {
      op: "create-relation",
      view: "mapward://_metrics/canvas",
      from: "mapward://systems/shop/cart",
      to: "mapward://systems/bank",
      fromSide: "top",
    },
  );
  expect(result.writes.size).toBe(0);
});

test("deleting an object takes its relations along and forgets it in every view", () => {
  const result = run(context, { op: "delete-object", object: "mapward://systems/shop" });
  expect(result.ops).toEqual([
    { op: "delete", address: "mapward://systems/shop" },
    { op: "delete", address: "mapward://relations/cart-to-bank" },
  ]);
  const state = stateOf(result);
  expect(state.refs).toEqual([]);
  expect(state.positions).toEqual({});
});

test("rename writes the own index whole: the name, or the props field the view labels with", () => {
  const index = "/map/systems/bank/_index.json";
  expect(
    editSources(map, isView, { op: "rename", object: "mapward://systems/bank", label: "x" }),
  ).toEqual([STATE, index]);
  const withIndex: EditContext = {
    ...context,
    files: new Map([...files, [index, '{ "name": "Банк", "props": { "rate": 3 } }']]),
  };
  expect(
    run(withIndex, { op: "rename", object: "mapward://systems/bank", label: " Банк-партнёр " }),
  ).toEqual({
    ops: [
      {
        op: "set",
        address: "mapward://systems/bank",
        content: { name: "Банк-партнёр", props: { rate: 3 } },
      },
    ],
    writes: new Map(),
  });
  const labelled = object("mapward://", "Карта", {
    ...map,
    metrics: [
      {
        ...viewMetric,
        config: {
          ...viewMetric.config,
          params: { ...viewMetric.config.params, style: { all: { label: "title" } } },
        },
      },
    ],
  });
  expect(
    run(
      { ...withIndex, root: labelled },
      {
        op: "rename",
        view: "mapward://_metrics/canvas",
        object: "mapward://systems/bank",
        label: "Банк",
      },
    ).ops,
  ).toEqual([
    {
      op: "set",
      address: "mapward://systems/bank",
      content: { name: "Банк", props: { rate: 3, title: "Банк" } },
    },
  ]);
});

test("a view without a place for new objects refuses to create on empty space", () => {
  const bare = object("mapward://", "Карта", {
    metrics: [{ ...viewMetric, config: { ...viewMetric.config, params: {} } }],
    children: [],
  });
  const plan = planEdit(
    { root: bare, files: new Map(), isView },
    { op: "create-object", view: "mapward://_metrics/canvas", name: "X" },
  );
  expect("error" in plan).toBe(true);
});

test("an object carried out onto the canvas stays on it as a ref when the view does not pick it", () => {
  const result = run(context, {
    op: "move-object",
    object: "mapward://systems/shop/cart",
    parent: "mapward://",
    view: "mapward://_metrics/canvas",
  });
  expect(stateOf(result).refs).toEqual(["mapward://cart"]);
});

test("a line is a shape with ends, and its style rides in the view state", () => {
  const result = run(context, {
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
  });
  expect(result.ops).toEqual([]);
  expect(stateOf(result).shapes[0]).toMatchObject({
    kind: "line",
    from: { node: "mapward://systems/bank" },
  });
});

test("a stretched preview and a bent arrow are remembered by the view", () => {
  const sized = run(context, {
    op: "resize-nodes",
    view: "mapward://_metrics/canvas",
    sizes: { "mapward://systems/bank": { width: 400, height: 300 } },
  });
  expect(stateOf(sized).sizes["mapward://systems/bank"]).toEqual({ width: 400, height: 300 });

  const bent = run(context, {
    op: "set-bends",
    view: "mapward://_metrics/canvas",
    arrow: "a→b",
    bends: [{ x: 1, y: 2 }],
  });
  expect(stateOf(bent).bends["a→b"]).toEqual([{ x: 1, y: 2 }]);
});

test("an arrow keeps its own style on this view", () => {
  const result = run(context, {
    op: "style-arrow",
    view: "mapward://_metrics/canvas",
    arrow: "a→b",
    style: { stroke: "#f00", strokeWidth: 3, fontSize: 16, route: "orthogonal" },
  });
  expect(stateOf(result).arrows["a→b"]).toEqual({
    stroke: "#f00",
    strokeWidth: 3,
    fontSize: 16,
    route: "orthogonal",
  });
});

test("a copy is the platform's copy; a relation with an end outside stays with the original", () => {
  const result = run(context, {
    op: "copy-objects",
    view: "mapward://_metrics/canvas",
    objects: ["mapward://systems/shop"],
  });
  expect(result.ops).toEqual([
    {
      op: "copy",
      objects: [{ object: "mapward://systems/shop", parent: "mapward://systems" }],
    },
  ]);
  const state = stateOf(result);
  expect(state.positions["mapward://systems/shop-2/cart"]).toEqual({ x: 1, y: 2 });
  expect(state.positions["mapward://systems/shop/cart"]).toEqual({ x: 1, y: 2 });
  // Магазин вьюха выбирает шаблоном `systems/*` — его копия видна и без ссылки.
  expect(state.refs).toEqual(["mapward://systems/shop/cart"]);
});

test("a relation with both ends in the copy is copied next to itself", () => {
  const result = run(context, {
    op: "copy-objects",
    view: "mapward://_metrics/canvas",
    objects: ["mapward://systems/shop", "mapward://systems/bank", "mapward://systems/shop/cart"],
    positions: { "mapward://systems/bank": { x: 5, y: 6 } },
  });
  // Корзина едет вместе с магазином и второй раз не копируется.
  expect(result.ops).toEqual([
    {
      op: "copy",
      objects: [
        { object: "mapward://systems/shop", parent: "mapward://systems" },
        { object: "mapward://systems/bank", parent: "mapward://systems" },
        { object: "mapward://relations/cart-to-bank", parent: "mapward://relations" },
      ],
    },
  ]);
  expect(stateOf(result).positions["mapward://systems/bank-2"]).toEqual({ x: 5, y: 6 });
});

test("a copy lands in the named group and stands there as a ref when the view does not pick it", () => {
  const result = run(context, {
    op: "copy-objects",
    view: "mapward://_metrics/canvas",
    objects: ["mapward://systems/bank"],
    parent: "mapward://systems/shop",
  });
  expect(stateOf(result).refs).toContain("mapward://systems/shop/bank");
});

test("a copy of an object deleted after copying is refused", () => {
  const plan = planEdit(context, {
    op: "copy-objects",
    view: "mapward://_metrics/canvas",
    objects: ["mapward://systems/gone"],
  });
  expect("error" in plan && plan.error).toContain("удалили");
});

/** Контекст, где на магазине нарисована пометка, а на холсте — ещё одна. */
const withShapes: EditContext = {
  root: map,
  isView,
  files: new Map([
    [
      STATE,
      JSON.stringify({
        shapes: [
          { id: "s1", kind: "rect", parent: "mapward://systems/shop", x: 10, y: 20 },
          { id: "s2", kind: "text", x: 0, y: 0, text: "холст" },
        ],
      }),
    ],
  ]),
};

test("a shape drawn on a group is copied with it onto the copy", () => {
  const result = run(withShapes, {
    op: "copy-objects",
    view: "mapward://_metrics/canvas",
    objects: ["mapward://systems/shop"],
  });
  expect(stateOf(result).shapes).toEqual([
    { id: "s1", kind: "rect", parent: "mapward://systems/shop", x: 10, y: 20 },
    { id: "s2", kind: "text", x: 0, y: 0, text: "холст" },
    { id: "s1-2", kind: "rect", parent: "mapward://systems/shop-2", x: 10, y: 20 },
  ]);
});

test("a shape drawn on a group goes away with it and follows its new address", () => {
  const gone = run(withShapes, { op: "delete-object", object: "mapward://systems/shop" });
  expect(stateOf(gone).shapes.map((shape: { id: string }) => shape.id)).toEqual(["s2"]);

  const moved = run(withShapes, {
    op: "set-folder",
    object: "mapward://systems/shop",
    folder: "store",
  });
  expect(stateOf(moved).shapes[0].parent).toBe("mapward://systems/store");
});

/** Та же карта, где магазин — фрейм, а у банка на холсте копия с привязанной связью. */
const framed: MapObject = {
  ...map,
  metrics: [
    {
      ...viewMetric,
      config: {
        ...viewMetric.config,
        params: { ...viewMetric.config.params, expand: { objects: ["systems/shop"] } },
      },
    },
  ],
};
const withCopy: EditContext = {
  root: framed,
  isView,
  files: new Map([
    [
      STATE,
      JSON.stringify({
        positions: { "mapward://systems/bank#2": { x: 7, y: 8 } },
        copies: { "mapward://systems/bank#2": { object: "mapward://systems/bank" } },
        ends: { "mapward://relations/cart-to-bank": { to: "mapward://systems/bank#2" } },
      }),
    ],
  ]),
};
const canvas = "mapward://_metrics/canvas";

test("a display copy is a record in the view state, not a folder", () => {
  const result = run(withCopy, {
    op: "put-copy",
    view: canvas,
    copy: "mapward://systems/bank#3",
    parent: "mapward://systems/shop",
    position: { x: 1, y: 1 },
  });
  expect(result.ops).toEqual([]);
  const state = stateOf(result);
  expect(state.copies["mapward://systems/bank#3"]).toEqual({
    object: "mapward://systems/bank",
    parent: "mapward://systems/shop",
  });
  expect(state.positions["mapward://systems/bank#3"]).toEqual({ x: 1, y: 1 });
});

test("a frame is not copied, and a copy lies only on a frame", () => {
  const frame = planEdit(withCopy, {
    op: "put-copy",
    view: canvas,
    copy: "mapward://systems/shop#2",
  });
  expect("error" in frame && frame.error).toContain("фрейма");
  const onCard = planEdit(withCopy, {
    op: "put-copy",
    view: canvas,
    copy: "mapward://systems/bank#3",
    parent: "mapward://systems/bank",
  });
  expect("error" in onCard && onCard.error).toContain("не фрейм");
});

test("a relation drawn to a copy keeps the object address and binds the end to the copy", () => {
  const result = run(withCopy, {
    op: "create-relation",
    view: canvas,
    from: "mapward://systems/shop",
    to: "mapward://systems/bank#2",
  });
  expect(result.ops[0]).toMatchObject({
    content: { props: { from: "mapward://systems/shop", to: "mapward://systems/bank" } },
  });
  expect(stateOf(result).ends["mapward://relations/shop-to-bank"]).toEqual({
    to: "mapward://systems/bank#2",
  });
});

test("removing a copy takes the relations bound to it and leaves the object", () => {
  const result = run(withCopy, {
    op: "remove-copy",
    view: canvas,
    copy: "mapward://systems/bank#2",
  });
  expect(result.ops).toEqual([{ op: "delete", address: "mapward://relations/cart-to-bank" }]);
  const state = stateOf(result);
  expect(state.copies).toEqual({});
  expect(state.positions).toEqual({});
  expect(state.ends).toEqual({});
});

test("deleting the object takes its copies", () => {
  const state = stateOf(run(withCopy, { op: "delete-object", object: "mapward://systems/bank" }));
  expect(state.copies).toEqual({});
  expect(state.positions).toEqual({});
});

test("moving the object rewrites its copies", () => {
  const state = stateOf(
    run(withCopy, { op: "set-folder", object: "mapward://systems/bank", folder: "vault" }),
  );
  expect(state.copies["mapward://systems/vault#2"]).toEqual({ object: "mapward://systems/vault" });
  expect(state.positions["mapward://systems/vault#2"]).toEqual({ x: 7, y: 8 });
  expect(state.ends["mapward://relations/cart-to-bank"]).toEqual({
    to: "mapward://systems/vault#2",
  });
});
