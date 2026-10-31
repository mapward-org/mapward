import { expect, test } from "vitest";
import type { MapMetric, MapObject } from "@mapward/core";
import { mapFiles, planEdit, referencesTo, rewriteJson, slug } from "./plan.ts";
import type { EditContext, EditPlan, FileChange } from "./plan.ts";

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

const metric = (owner: string, key: string): MapMetric => {
  const folder = `/map/${owner.replace("mapward://", "")}/_metrics/${key}`;
  return {
    key,
    address: `${owner}/_metrics/${key}`,
    configPath: `${folder}/config.json`,
    cachePath: folder,
    layers: [],
    config: { label: key },
  };
};

const map = object("mapward://", "Карта", {
  children: [
    object("mapward://prototypes", "prototypes", {
      isGroup: true,
      children: [object("mapward://prototypes/service", "Сервис")],
    }),
    object("mapward://systems", "systems", {
      isGroup: true,
      children: [
        object("mapward://systems/shop", "Магазин", {
          metrics: [metric("mapward://systems/shop", "load")],
          children: [object("mapward://systems/shop/cart", "Корзина")],
        }),
        object("mapward://systems/shopping", "Покупки"),
        object("mapward://systems/bank", "Банк"),
      ],
    }),
    object("mapward://links", "links", {
      isGroup: true,
      children: [object("mapward://links/cart-to-bank", "зовёт")],
    }),
  ],
});

const files = new Map<string, string>([
  ["/map/systems/shop/_index.json", '{ "name": "Магазин" }\n'],
  [
    "/map/systems/shop/cart/_index.json",
    '{ "name": "Корзина", "extends": "mapward://prototypes/service" }\n',
  ],
  [
    "/map/systems/shop/_metrics/load/config.json",
    '{\n  "label": "нагрузка",\n  "params": { "of": ["mapward://systems/shop/cart#props.rps", "mapward://systems/shopping"] }\n}\n',
  ],
  ["/map/systems/shopping/_index.json", '{ "name": "Покупки" }\n'],
  [
    "/map/systems/bank/_index.json",
    '{ "name": "Банк", "props": { "clients": { "main": "mapward://systems/shop/cart/x" } } }\n',
  ],
  [
    "/map/links/cart-to-bank/_index.json",
    '{ "name": "зовёт", "props": { "from": "mapward://systems/shop/cart", "to": "mapward://systems/bank" } }\n',
  ],
]);

const context: EditContext = { root: map, files };

const ok = (plan: EditPlan) => {
  if ("error" in plan) throw new Error(plan.error);
  return plan;
};

const written = (list: FileChange[], path: string) => {
  const change = list.find((item) => item.kind === "write" && item.path === path);
  return change?.kind === "write" ? change.text : undefined;
};

test("the map files are every index and every own layer config", () => {
  const paths = mapFiles(map);
  expect(paths).toContain("/map/systems/shop/cart/_index.json");
  expect(paths).toContain("/map/systems/shop/_metrics/load/config.json");
  expect(paths.some((path) => path.startsWith("/map/systems/_index"))).toBe(false);
});

test("a new object takes a free folder from its name; the index is written as given", () => {
  const content = {
    name: "Магазин",
    extends: "mapward://prototypes/service",
    props: { owner: "команда" },
  };
  const plan = ok(planEdit(context, { op: "create", parent: "mapward://systems", content }));
  expect(plan.created).toBe("mapward://systems/магазин");
  expect(JSON.parse(written(plan.changes, "/map/systems/магазин/_index.json") ?? "")).toEqual(
    content,
  );
  expect(
    planEdit(context, {
      op: "create",
      parent: "mapward://systems",
      content: { name: "x", extends: "mapward://no" },
    }),
  ).toEqual({ error: "Нет прототипа mapward://no" });
  expect(planEdit(context, { op: "create", parent: "mapward://systems", content: {} })).toEqual({
    error: "Ни имени папки (folder), ни content.name — папку назвать нечем",
  });
});

test("folders are implicit: a parent that is not there yet is made by the write", () => {
  const plan = ok(
    planEdit(context, {
      op: "create",
      parent: "mapward://nowhere/deep",
      folder: "x",
      content: { name: "X" },
    }),
  );
  expect(plan.created).toBe("mapward://nowhere/deep/x");
  expect(written(plan.changes, "/map/nowhere/deep/x/_index.json")).toContain('"X"');
  expect(
    planEdit(context, { op: "create", parent: "mapward://_metrics", content: { name: "X" } }),
  ).toEqual({ error: "mapward://_metrics — не адрес карты, куда класть новый" });
});

test("a move rewrites the address wherever it stands as a string, and nothing that only starts like it", () => {
  const plan = ok(
    planEdit(context, {
      op: "move",
      object: "mapward://systems/shop/cart",
      parent: "mapward://systems/bank",
    }),
  );
  expect(plan.changes[0]).toEqual({
    kind: "move",
    from: "/map/systems/shop/cart",
    to: "/map/systems/bank/cart",
  });
  expect(plan.moves).toEqual([
    { from: "mapward://systems/shop/cart", to: "mapward://systems/bank/cart" },
  ]);
  // Концы связи — просто строки в `props`: про связи библиотека не знает, а адрес переезжает.
  expect(written(plan.changes, "/map/links/cart-to-bank/_index.json")).toBe(
    '{ "name": "зовёт", "props": { "from": "mapward://systems/bank/cart", "to": "mapward://systems/bank" } }\n',
  );
  // Вложенное значение и адрес внутри перенесённого; разметка файла остаётся своей.
  expect(written(plan.changes, "/map/systems/bank/_index.json")).toBe(
    '{ "name": "Банк", "props": { "clients": { "main": "mapward://systems/bank/cart/x" } } }\n',
  );
  // Конфиг метрики: адрес с полем после `#` — в массиве; `shopping` — не `shop`.
  expect(written(plan.changes, "/map/systems/shop/_metrics/load/config.json")).toBe(
    '{\n  "label": "нагрузка",\n  "params": { "of": ["mapward://systems/bank/cart#props.rps", "mapward://systems/shopping"] }\n}\n',
  );
  expect(written(plan.changes, "/map/systems/shopping/_index.json")).toBeUndefined();
});

test("a moved prototype is followed by `extends` of its heirs", () => {
  const plan = ok(
    planEdit(context, {
      op: "setFolder",
      object: "mapward://prototypes/service",
      folder: "Сервис API",
    }),
  );
  expect(plan.changes[0]).toEqual({
    kind: "move",
    from: "/map/prototypes/service",
    to: "/map/prototypes/сервис-api",
  });
  expect(written(plan.changes, "/map/systems/shop/cart/_index.json")).toContain(
    '"extends": "mapward://prototypes/сервис-api"',
  );
});

test("a move is refused inside itself and onto a taken name", () => {
  expect(
    planEdit(context, {
      op: "move",
      object: "mapward://systems/shop",
      parent: "mapward://systems/shop/cart",
    }),
  ).toEqual({ error: "Объект нельзя перенести внутрь самого себя" });
  expect(
    planEdit(context, { op: "setFolder", object: "mapward://systems/shop", folder: "bank" }),
  ).toEqual({ error: "В systems уже есть bank" });
});

test("only map files are rewritten: anything else the context knows rides as is", () => {
  const plan = ok(
    planEdit(
      {
        root: map,
        files: new Map([...files, ["/map/_directives/x.md", "mapward://systems/shop"]]),
      },
      { op: "move", object: "mapward://systems/shop", parent: "mapward://prototypes" },
    ),
  );
  expect(written(plan.changes, "/map/_directives/x.md")).toBeUndefined();
  // Переезды — с потомками: свои файлы с адресами зовущий переписывает по ним.
  expect(plan.moves).toEqual([
    { from: "mapward://systems/shop", to: "mapward://prototypes/shop" },
    { from: "mapward://systems/shop/cart", to: "mapward://prototypes/shop/cart" },
  ]);
});

test("a copy points at the copies, keeps the rest, and leaves the skipped behind", () => {
  const plan = ok(
    planEdit(context, {
      op: "copy",
      objects: [
        { object: "mapward://systems/shop", parent: "mapward://systems" },
        { object: "mapward://links/cart-to-bank", parent: "mapward://links" },
      ],
      skip: ["mapward://systems/shop/cart"],
    }),
  );
  expect(plan.copies).toEqual([
    { from: "mapward://systems/shop", to: "mapward://systems/shop-2" },
    { from: "mapward://links/cart-to-bank", to: "mapward://links/cart-to-bank-2" },
  ]);
  expect(written(plan.changes, "/map/systems/shop-2/_index.json")).toBe('{ "name": "Магазин" }\n');
  expect(written(plan.changes, "/map/systems/shop-2/cart/_index.json")).toBeUndefined();
  expect(written(plan.changes, "/map/links/cart-to-bank-2/_index.json")).toContain(
    '"from": "mapward://systems/shop-2/cart"',
  );
  expect(written(plan.changes, "/map/systems/shop/_index.json")).toBeUndefined();
});

test("delete takes the folder to the trash; a shelf with objects goes only when told", () => {
  const plan = ok(planEdit(context, { op: "delete", address: "mapward://systems/shop" }));
  expect(plan.changes).toEqual([{ kind: "remove", path: "/map/systems/shop" }]);
  expect(planEdit(context, { op: "delete", address: "mapward://systems" })).toEqual({
    error:
      "В полке mapward://systems есть объекты: mapward://systems/bank, mapward://systems/shop, mapward://systems/shop/cart, mapward://systems/shopping. Унеси их или удали с recursive: true",
  });
  expect(
    ok(planEdit(context, { op: "delete", address: "mapward://systems", recursive: true })).changes,
  ).toEqual([{ kind: "remove", path: "/map/systems" }]);
});

test("a shelf moves and renames like an object: every address inside follows", () => {
  const plan = ok(
    planEdit(context, { op: "setFolder", object: "mapward://links", folder: "Связи" }),
  );
  expect(plan.moves).toEqual([
    { from: "mapward://links", to: "mapward://связи" },
    { from: "mapward://links/cart-to-bank", to: "mapward://связи/cart-to-bank" },
  ]);
  expect(plan.changes[0]).toEqual({ kind: "move", from: "/map/links", to: "/map/связи" });
  const moved = ok(
    planEdit(context, { op: "move", object: "mapward://systems", parent: "mapward://prototypes" }),
  );
  expect(written(moved.changes, "/map/links/cart-to-bank/_index.json")).toContain(
    "mapward://prototypes/systems/shop/cart",
  );
  // Полку не копируют: копия — дело объекта.
  expect(
    planEdit(context, {
      op: "copy",
      objects: [{ object: "mapward://systems", parent: "mapward://prototypes" }],
    }),
  ).toEqual({ error: "Нет объекта mapward://systems: его удалили или перенесли" });
});

test("references to an object are its address, or a field of it — not a child", () => {
  expect(referencesTo(files, "mapward://systems/shop/cart", () => false)).toEqual([
    "/map/systems/shop/_metrics/load/config.json",
    "/map/links/cart-to-bank/_index.json",
  ]);
  expect(referencesTo(files, "mapward://systems/shop", () => false)).toEqual([]);
});

test("json rewriting touches strings only, keys included", () => {
  const renames = new Map([["mapward://a", "mapward://b"]]);
  expect(rewriteJson('{"mapward://a/x": ["mapward://a", "mapward://ab", 1]}', renames)).toBe(
    '{"mapward://b/x": ["mapward://b", "mapward://ab", 1]}',
  );
});

test("a folder name keeps any alphabet and drops the rest", () => {
  expect(slug("  Сервис заказов!  ")).toBe("сервис-заказов");
  expect(slug("???")).toBe("объект");
});
