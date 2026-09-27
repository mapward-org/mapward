import { expect, test } from "vitest";
import type { EditResult, MapOp, ObjectsMap } from "@mapward/core";
import { deleteOp } from "../pure-model/tools.ts";
import { ObjectsMapStore } from "./objects-map.ts";

const views = {
  slot<T>(_key: string, initial: T) {
    return { value: initial, set() {} };
  },
};

const map: ObjectsMap = {
  view: "v",
  nodes: [
    {
      id: "mapward://a",
      kind: "object",
      label: "А",
      link: "mapward://a",
      object: "mapward://a",
      shape: "rect",
      view: "simple",
      expanded: false,
      position: { x: 0, y: 0 },
    },
  ],
  relations: [],
  shapes: [],
  palette: { objects: [], relations: [] },
  canPlaceObjects: true,
  canPlaceRelations: true,
};

function fake(results: EditResult[]) {
  const calls: string[] = [];
  const sent: MapOp[][] = [];
  let n = 0;
  const next = (): EditResult => {
    n += 1;
    return results[n - 1] ?? { ok: true, id: `e${n}`, touched: [] };
  };
  return {
    calls,
    sent,
    port: {
      edit: async (ops: MapOp[]) => {
        calls.push(`edit ${ops.map((op) => op.op).join("+")}`);
        sent.push(ops);
        return next();
      },
      undo: async (id: string) => {
        calls.push(`undo ${id}`);
        return next();
      },
      redo: async (id: string) => {
        calls.push(`redo ${id}`);
        return next();
      },
      open: () => {},
    },
  };
}

test("a successful edit goes onto the undo stack, undo and redo walk it", async () => {
  const { port, calls } = fake([
    { ok: true, id: "a", touched: [] },
    { ok: true, id: "b", touched: [] },
    { ok: true, id: "b", touched: [] },
    { ok: true, id: "b", touched: [] },
  ]);
  const store = new ObjectsMapStore(port, views, "mapward://_metrics/canvas");
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }], map);
  await store.edit([{ op: "resize-nodes", view: "v", sizes: {} }], map);
  await store.undo();
  expect(store.canRedo).toBe(true);
  await store.redo();
  expect(calls).toEqual(["edit move-nodes", "edit resize-nodes", "undo b", "redo b"]);
  expect(store.canRedo).toBe(false);
});

test("a refusal is said on the canvas and tells the caller to put the node back", async () => {
  const { port } = fake([{ ok: false, error: "В Банк уже есть cart" }]);
  const store = new ObjectsMapStore(port, views, "v");
  const ok = await store.edit([{ op: "move-object", object: "a", parent: "b" }], map);
  expect(ok).toBe(false);
  expect(store.message).toEqual({ text: "В Банк уже есть cart", error: true });
  expect(store.canUndo).toBe(false);
});

test("an undo refused by the server stays on the stack", async () => {
  const { port } = fake([
    { ok: true, id: "a", touched: [] },
    { ok: false, error: "Файлы поменяли мимо отмены: x" },
  ]);
  const store = new ObjectsMapStore(port, views, "v");
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }], map);
  await store.undo();
  expect(store.canUndo).toBe(true);
  expect(store.message?.text).toContain("мимо отмены");
});

test("a new edit drops what was undone", async () => {
  const { port } = fake([]);
  const store = new ObjectsMapStore(port, views, "v");
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }], map);
  await store.undo();
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }], map);
  expect(store.canRedo).toBe(false);
});

test("each deletable has its own operation: object, ref, shape", () => {
  expect(deleteOp("v", { kind: "object", id: "a", label: "" })).toEqual({
    op: "delete-object",
    object: "a",
  });
  expect(deleteOp("v", { kind: "ref", id: "a", label: "" })).toEqual({
    op: "remove-ref",
    view: "v",
    object: "a",
  });
  expect(deleteOp("v", { kind: "shape", id: "s", label: "" })).toEqual({
    op: "remove-shape",
    view: "v",
    id: "s",
  });
});

test("an edit shows on the canvas at once and leaves when a new value of the view arrives", async () => {
  const pending: ((result: EditResult) => void)[] = [];
  const answer = (result: EditResult) => pending.shift()?.(result);
  const port = {
    edit: () => new Promise<EditResult>((resolve) => pending.push(resolve)),
    undo: async () => ({ ok: true as const, id: "", touched: [] }),
    redo: async () => ({ ok: true as const, id: "", touched: [] }),
    open: () => {},
  };
  const store = new ObjectsMapStore(port, views, "v");
  const done = store.edit(
    [{ op: "move-nodes", view: "v", positions: { "mapward://a": { x: 50, y: 60 } } }],
    map,
  );
  expect(store.picture(map).nodes[0]?.position).toEqual({ x: 50, y: 60 });
  answer({ ok: true, id: "e1", touched: [] });
  await done;
  // Подписка присылает снимок с тем же старым содержимым новым объектом — узел не прыгает назад.
  const stale = { ...map, nodes: map.nodes.map((node) => ({ ...node })) };
  expect(store.picture(stale).nodes[0]?.position).toEqual({ x: 50, y: 60 });
  // Тот же по содержимому снимок — та же картинка: холст не пересобирает узлы.
  expect(store.picture(stale)).toBe(store.picture(map));
  const fresh = { ...map, nodes: [{ ...map.nodes[0]!, position: { x: 50, y: 60 } }] };
  expect(store.picture(fresh)).toBe(fresh);
});

test("a refused edit leaves the canvas at once and the node is back", async () => {
  const { port } = fake([{ ok: false, error: "нельзя" }]);
  const store = new ObjectsMapStore(port, views, "v");
  await store.edit(
    [{ op: "move-nodes", view: "v", positions: { "mapward://a": { x: 50, y: 60 } } }],
    map,
  );
  expect(store.picture(map).nodes[0]?.position).toEqual({ x: 0, y: 0 });
});

test("a dropped card is a draft: Enter creates it with the name, Esc leaves nothing", async () => {
  const { port, sent } = fake([]);
  const store = new ObjectsMapStore(port, views, "v");
  store.place({ prototype: "mapward://prototypes/event", position: { x: 1, y: 2 } });
  expect(store.picture(map).nodes.some((node) => node.id === "draft:new")).toBe(true);
  store.dropDraft();
  expect(store.picture(map).nodes.some((node) => node.id === "draft:new")).toBe(false);
  expect(sent).toEqual([]);

  store.place({ prototype: "mapward://prototypes/event", position: { x: 1, y: 2 } });
  await store.commitDraft("Заказ оплачен", map);
  expect(sent).toEqual([
    [
      {
        op: "create-object",
        view: "v",
        name: "Заказ оплачен",
        prototype: "mapward://prototypes/event",
        position: { x: 1, y: 2 },
      },
    ],
  ]);
});

test("the dialog sends name and address as one batch — one undo", async () => {
  const { port, sent } = fake([]);
  const store = new ObjectsMapStore(port, views, "v");
  store.startEdit("mapward://a", map);
  expect(store.editing).toEqual({ address: "mapward://a", name: "А", folder: "a" });
  await store.save("Альфа", "alpha", map);
  expect(sent).toEqual([
    [
      { op: "rename", object: "mapward://a", label: "Альфа", view: "v" },
      { op: "set-folder", object: "mapward://a", folder: "alpha", view: "v" },
    ],
  ]);
  expect(store.canUndo).toBe(true);
});

test("a line takes two clicks: the start, then the end with the line itself", async () => {
  const { port, sent } = fake([]);
  const store = new ObjectsMapStore(port, views, "v");
  store.choose({ kind: "line" });
  await store.lineAt({ node: "mapward://a" }, map);
  expect(sent).toEqual([]);
  await store.lineAt({ x: 10, y: 20 }, map);
  const [[op] = []] = sent;
  const shape = op?.op === "put-shape" ? op.shape : undefined;
  expect(shape).toMatchObject({
    kind: "line",
    from: { node: "mapward://a" },
    to: { x: 10, y: 20 },
  });
  expect(store.tool).toEqual({ kind: "select" });
});

test("the same selection reported again does not touch the store", () => {
  const { port } = fake([]);
  const store = new ObjectsMapStore(port, views, "v");
  store.select({ kind: "arrow", id: "a→b" });
  const first = store.selected;
  // Холст сообщает выделение на каждой перерисовке новым объектом — стор не должен меняться.
  store.select({ kind: "arrow", id: "a→b" });
  expect(store.selected).toBe(first);
  store.select(undefined);
  expect(store.selected).toBeUndefined();
});

test("a folded rail stays folded for the next canvas, it lives in the viewer's state", () => {
  const stored = new Map<string, unknown>();
  const kept = {
    slot<T>(key: string, initial: T) {
      return {
        get value() {
          return (stored.has(key) ? stored.get(key) : initial) as T;
        },
        set(value: T) {
          stored.set(key, value);
        },
      };
    },
  };
  const { port } = fake([]);
  const first = new ObjectsMapStore(port, kept, "v");
  first.toggleRailMore();
  first.toggleRail();
  expect(first.railFolded).toBe(true);
  expect(first.railMore).toBe(false);
  expect(new ObjectsMapStore(port, kept, "other").railFolded).toBe(true);
});

test("a new relation and a new shape come dressed in the last style, as in Miro", async () => {
  const memory = {
    slot<T>(key: string, initial: T) {
      const seeded: Record<string, unknown> = {
        "objects-map:last-style": { arrow: { strokeWidth: 3 }, rect: { color: "#ffd166" } },
      };
      return { value: (seeded[key] ?? initial) as T, set() {} };
    },
  };
  const { port, sent } = fake([]);
  const store = new ObjectsMapStore(port, memory, "v");
  await store.relate("mapward://a", "mapward://b", "mapward://prototypes/relation", map);
  expect(sent[0]).toEqual([
    {
      op: "create-relation",
      view: "v",
      from: "mapward://a",
      to: "mapward://b",
      prototype: "mapward://prototypes/relation",
    },
    { op: "style-arrow", view: "v", arrow: "mapward://a→mapward://b", style: { strokeWidth: 3 } },
  ]);
  await store.drawShape({ id: "s", kind: "rect", x: 0, y: 0 }, map);
  expect(sent[1]).toEqual([
    { op: "put-shape", view: "v", shape: { id: "s", kind: "rect", x: 0, y: 0, color: "#ffd166" } },
  ]);
  expect(store.tool).toEqual({ kind: "select" });
});
