import { expect, test } from "vitest";
import type { MapMetric, MapObject } from "@mapward/core";
import type { FileEntry, FilesPort } from "../../../../ports/index.ts";
import { ApplySteps } from "../services/apply-steps.ts";
import { EditHistory } from "../services/edit-history.ts";
import { EditMap } from "./edit-map.ts";
import { ToggleEdit } from "./toggle-edit.ts";

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** Диск в памяти: перенос папки — это перенос всех путей под ней, как у настоящего. */
function fakeFiles(tree: Record<string, string>): Required<FilesPort> {
  return {
    read: (path) => Promise.resolve(tree[path]),
    list: (dir) => {
      const names = new Map<string, boolean>();
      for (const path of Object.keys(tree)) {
        if (!path.startsWith(`${dir}/`)) continue;
        const [head = "", ...rest] = path.slice(dir.length + 1).split("/");
        names.set(head, rest.length > 0);
      }
      return Promise.resolve(
        [...names].map(([name, isDirectory]): FileEntry => ({ name, isDirectory })),
      );
    },
    write: (path, text) => {
      tree[path] = text;
      return Promise.resolve();
    },
    remove: (path) => {
      delete tree[path];
      return Promise.resolve();
    },
    move: (from, to) => {
      for (const path of Object.keys(tree)) {
        if (!under(path, from)) continue;
        tree[to + path.slice(from.length)] = tree[path] ?? "";
        delete tree[path];
      }
      return Promise.resolve();
    },
    watch: () => () => undefined,
    realpath: (path) => Promise.resolve(path),
  };
}

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

const view: MapMetric = {
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
        placeObjects: "mapward://systems",
        placeRelations: "mapward://relations",
      },
    ],
  },
};

const root = object("mapward://", "Карта", {
  metrics: [view],
  children: [
    object("mapward://systems", "systems", {
      isGroup: true,
      children: [object("mapward://systems/bank", "Банк")],
    }),
    object("mapward://relations", "relations", { isGroup: true }),
  ],
});

const ref = { mapPath: "/map", basePath: "/", name: "Карта" };

function setup(tree: Record<string, string>) {
  const files = fakeFiles(tree);
  const refreshed: string[] = [];
  const map = {
    current: () => Promise.resolve(root),
    refresh: (paths: string[]) => {
      refreshed.push(...paths);
      return Promise.resolve();
    },
  };
  const apply = new ApplySteps(files, files, files, map);
  const history = new EditHistory();
  return {
    refreshed,
    edit: new EditMap(map, files, apply, history),
    undo: new ToggleEdit(apply, history, "done"),
    redo: new ToggleEdit(apply, history, "undone"),
  };
}

const create = {
  op: "create-object" as const,
  view: "mapward://_metrics/canvas",
  name: "Склад",
  position: { x: 1, y: 2 },
};

test("a created object goes away on undo and comes back on redo", async () => {
  const tree: Record<string, string> = { "/map/systems/bank/_index.json": "{}" };
  const { edit, undo, redo, refreshed } = setup(tree);

  const done = await edit.run(ref, [create]);
  if (!done.ok) throw new Error(done.error);
  expect(JSON.parse(tree["/map/systems/склад/_index.json"] ?? "{}").name).toBe("Склад");
  expect(tree["/map/_metrics/canvas/map-state.json"]).toContain('"x": 1');
  expect(refreshed).toContain("/map/systems/склад/_index.json");

  const undone = await undo.run(ref, done.id);
  expect(undone.ok).toBe(true);
  expect(tree["/map/systems/склад/_index.json"]).toBeUndefined();
  expect(tree["/map/_metrics/canvas/map-state.json"]).toBeUndefined();

  const again = await redo.run(ref, done.id);
  expect(again.ok).toBe(true);
  expect(tree["/map/systems/склад/_index.json"]).toContain("Склад");
});

test("undo refuses when a written file was changed past it", async () => {
  const tree: Record<string, string> = {};
  const { edit, undo } = setup(tree);
  const done = await edit.run(ref, [create]);
  if (!done.ok) throw new Error(done.error);

  tree["/map/systems/склад/_index.json"] = '{ "name": "Склад, поправленный руками" }';
  const undone = await undo.run(ref, done.id);
  expect(undone).toEqual({
    ok: false,
    error: "Файлы поменяли мимо правки, не трогаю: /map/systems/склад/_index.json",
  });
  expect(tree["/map/systems/склад/_index.json"]).toContain("руками");
});

test("a refused op rolls the whole batch back", async () => {
  const tree: Record<string, string> = {};
  const { edit } = setup(tree);
  const result = await edit.run(ref, [
    create,
    {
      op: "create-relation",
      view: "mapward://_metrics/canvas",
      from: "mapward://systems/bank",
      to: "mapward://nowhere",
    },
  ]);
  expect(result).toEqual({
    ok: false,
    error: "Операция 2 (create-relation): Нет объекта mapward://nowhere",
  });
  expect(Object.keys(tree)).toEqual([]);
});

test("a deleted object waits in the batch trash and undo brings it back", async () => {
  const tree: Record<string, string> = {
    "/map/systems/bank/_index.json": '{ "name": "Банк" }',
    "/map/systems/bank/Purpose.md": "зачем",
  };
  const { edit, undo } = setup(tree);
  const done = await edit.run(ref, [{ op: "delete-object", object: "mapward://systems/bank" }]);
  if (!done.ok) throw new Error(done.error);
  expect(tree["/map/systems/bank/Purpose.md"]).toBeUndefined();
  expect(tree[`/map/.mapward/trash/${done.id}/systems/bank/Purpose.md`]).toBe("зачем");

  const undone = await undo.run(ref, done.id);
  expect(undone.ok).toBe(true);
  expect(tree["/map/systems/bank/Purpose.md"]).toBe("зачем");
});

test("an unknown batch and a second undo are refused with a reason", async () => {
  const { edit, undo } = setup({});
  expect((await undo.run(ref, "42")).ok).toBe(false);
  const done = await edit.run(ref, [create]);
  if (!done.ok) throw new Error(done.error);
  await undo.run(ref, done.id);
  expect(await undo.run(ref, done.id)).toEqual({
    ok: false,
    error: `Пачка ${done.id} уже отменена`,
  });
});
