import { expect, test } from "vitest";
import type { EditResult, MapOp } from "@mapward/core";
import { deleteOp } from "../pure-model/tools.ts";
import { ObjectsMapStore } from "./objects-map.ts";

const views = {
  slot<T>(_key: string, initial: T) {
    return { value: initial, set() {} };
  },
};

function fake(results: EditResult[]) {
  const calls: string[] = [];
  let n = 0;
  const next = (): EditResult => {
    n += 1;
    return results[n - 1] ?? { ok: true, id: `e${n}`, touched: [] };
  };
  return {
    calls,
    port: {
      edit: async (ops: MapOp[]) => {
        calls.push(`edit ${ops[0]?.op}`);
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
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }]);
  await store.edit([{ op: "set-expanded", view: "v", object: "x", expanded: true }]);
  await store.undo();
  expect(store.canRedo).toBe(true);
  await store.redo();
  expect(calls).toEqual(["edit move-nodes", "edit set-expanded", "undo b", "redo b"]);
  expect(store.canRedo).toBe(false);
});

test("a refusal is said on the canvas and tells the caller to put the node back", async () => {
  const { port } = fake([{ ok: false, error: "В Банк уже есть cart" }]);
  const store = new ObjectsMapStore(port, views, "v");
  const ok = await store.edit([{ op: "move-object", object: "a", parent: "b" }]);
  expect(ok).toBe(false);
  expect(store.message).toBe("В Банк уже есть cart");
  expect(store.canUndo).toBe(false);
});

test("an undo refused by the server stays on the stack", async () => {
  const { port } = fake([
    { ok: true, id: "a", touched: [] },
    { ok: false, error: "Файлы поменяли мимо отмены: x" },
  ]);
  const store = new ObjectsMapStore(port, views, "v");
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }]);
  await store.undo();
  expect(store.canUndo).toBe(true);
  expect(store.message).toContain("мимо отмены");
});

test("a new edit drops what was undone", async () => {
  const { port } = fake([]);
  const store = new ObjectsMapStore(port, views, "v");
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }]);
  await store.undo();
  await store.edit([{ op: "move-nodes", view: "v", positions: {} }]);
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
