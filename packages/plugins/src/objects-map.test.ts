import { expect, test } from "vitest";
import { runPlugin } from "@mapward/plugin";
import type {
  MapEditOp,
  MapEditResult,
  MapMetric,
  MapObject,
  PlatformMessage,
  PluginMessage,
} from "@mapward/plugin";
import { objectsMapPlugin } from "../registry/objects-map/index.ts";
import type { Disk } from "../registry/objects-map/model/journal.ts";
import type { EditResult } from "../registry/objects-map/model/ops.ts";
import type { ObjectsMap } from "../registry/objects-map/model/types.ts";

/**
 * Холст тем же рантаймом, что в процессе, против поддельного канала. Платформа здесь — тест: на
 * `ctx.tree` он отвечает картой, собранной из диска в памяти, и пересобирает её после каждой
 * записи — как вотчер, только сразу. `ctx.editMap` — подставной: создаёт и удаляет папки на том
 * же диске и помнит, что тронул, для отмены; настоящая правка карты проверяется у сервера.
 */

const MAP = { name: "m", mapPath: "/map", basePath: "/" };
const PLUGIN = "/map/_plugins/objects-map";
const VIEW = "mapward://_metrics/canvas";

const view: MapMetric = {
  key: "canvas",
  address: VIEW,
  configPath: "/map/_metrics/canvas/config.json",
  cachePath: "/map/_metrics/canvas",
  layers: [],
  config: {
    component: `${PLUGIN}/view.tsx`,
    params: {
      show: ["systems/*"],
      placeObjects: "mapward://systems",
      placeRelations: "mapward://relations",
    },
    agent: { plugin: PLUGIN, method: "view" },
  },
};

const under = (file: string, folder: string) => file === folder || file.startsWith(`${folder}/`);
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/** Диск в памяти; перенос папки — перенос всех путей под ней, как у настоящего. */
function memoryDisk(files: Record<string, string>, changed: () => void): Disk {
  return {
    read: async (file) => files[file],
    write: async (file, text) => {
      files[file] = text;
      changed();
    },
    remove: async (file) => {
      delete files[file];
      changed();
    },
  };
}

const folderName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "") || "объект";

const toAddress = (folder: string) => `mapward://${folder.slice("/map/".length)}`;
const toFolder = (address: string) => `/map/${address.slice("mapward://".length)}`;

/**
 * Подставная правка карты платформы: `create` и `delete` на диске в памяти, удалённое — в корзину
 * пачки. Пачка помнит, какие файлы тронула и какими они были, — отмена возвращает только их.
 */
function fakeEdits(files: Record<string, string>, changed: () => void) {
  type Batch = {
    state: "done" | "undone";
    before: Map<string, string | undefined>;
    after: Map<string, string | undefined>;
  };
  const batches = new Map<string, Batch>();
  let counter = 0;
  const put = (values: Map<string, string | undefined>) => {
    for (const [file, text] of values) {
      if (text === undefined) delete files[file];
      else files[file] = text;
    }
    changed();
  };
  return {
    edit(ops: MapEditOp[]): MapEditResult {
      const id = `m${++counter}`;
      const before = { ...files };
      const created: string[] = [];
      for (const op of ops) {
        if (op.op === "create") {
          const folder = `${toFolder(op.parent)}/${folderName(op.folder ?? String(op.content.name))}`;
          files[`${folder}/_index.json`] = JSON.stringify(op.content);
          created.push(toAddress(folder));
        } else if (op.op === "delete") {
          const folder = toFolder(op.address);
          if (!Object.keys(files).some((file) => under(file, folder))) {
            put(new Map(Object.entries(before)));
            return { ok: false, error: `Нет объекта ${op.address}` };
          }
          for (const file of Object.keys(files)) {
            if (!under(file, folder)) continue;
            files[`/map/.mapward/trash/${id}/${file.slice("/map/".length)}`] = files[file] ?? "";
            delete files[file];
          }
        } else return { ok: false, error: `подставная правка не умеет ${op.op}` };
      }
      const paths = new Set([...Object.keys(before), ...Object.keys(files)]);
      const was = new Map<string, string | undefined>();
      const now = new Map<string, string | undefined>();
      for (const file of paths) {
        if (before[file] === files[file]) continue;
        was.set(file, before[file]);
        now.set(file, files[file]);
      }
      batches.set(id, { state: "done", before: was, after: now });
      changed();
      return {
        ok: true,
        id,
        touched: [...now.keys()],
        created,
        moves: [],
        copies: [],
        results: [],
      };
    },
    toggle(id: string, from: "done" | "undone"): MapEditResult {
      const batch = batches.get(id);
      if (!batch || batch.state !== from) return { ok: false, error: `пачка ${id} не та` };
      put(from === "done" ? batch.before : batch.after);
      batch.state = from === "done" ? "undone" : "done";
      return { ok: true, id, touched: [], created: [], moves: [], copies: [], results: [] };
    },
  };
}

/** Карта из файлов: папка с `_index.json` — объект, без него — полка. Служебное не в счёт. */
function treeFrom(files: Record<string, string>): MapObject {
  const make = (folder: string, address: string): MapObject => {
    const raw = files[`${folder}/_index.json`];
    const index = raw ? (JSON.parse(raw) as { name?: string; props?: object }) : {};
    const names = new Set<string>();
    for (const file of Object.keys(files)) {
      if (!file.startsWith(`${folder}/`)) continue;
      const parts = file.slice(folder.length + 1).split("/");
      const head = parts[0] ?? "";
      if (parts.length > 1 && !head.startsWith("_") && !head.startsWith(".")) names.add(head);
    }
    return {
      address,
      path: folder,
      name: index.name ?? folder.split("/").at(-1) ?? "",
      isGroup: raw === undefined && address !== "mapward://",
      props: (index.props ?? {}) as Record<string, unknown>,
      layers: [],
      metrics: address === "mapward://" ? [view] : [],
      directives: [],
      actions: [],
      workflow: [],
      metricGroups: [],
      children: [...names]
        .toSorted()
        .map((name) =>
          make(
            `${folder}/${name}`,
            address === "mapward://" ? `${address}${name}` : `${address}/${name}`,
          ),
        ),
    } as unknown as MapObject;
  };
  return make("/map", "mapward://");
}

function platform(files: Record<string, string>) {
  const sent: PluginMessage[] = [];
  const trees = new Set<string>();
  let handler: ((message: PlatformMessage) => void) | undefined;
  const say = (message: PlatformMessage) => handler?.(message);
  let scheduled = false;
  // Вотчер платформы: после пачки записей — один новый снимок каждому, кто подписан.
  const changed = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      for (const id of trees) say({ t: "rnext", id, value: treeFrom(files) });
    }, 5);
  };
  const disk = memoryDisk(files, changed);
  const edits = fakeEdits(files, changed);
  const reply = (id: string, value: MapEditResult) =>
    queueMicrotask(() => {
      say({ t: "rnext", id, value });
      say({ t: "rcomplete", id });
    });
  runPlugin(objectsMapPlugin(disk), {
    send: (message) => {
      sent.push(message);
      if (message.t === "request" && message.op === "tree") {
        trees.add(message.id);
        queueMicrotask(() => say({ t: "rnext", id: message.id, value: treeFrom(files) }));
      }
      if (message.t === "request" && message.op === "editMap") {
        reply(message.id, edits.edit(message.ops));
      }
      if (message.t === "request" && message.op === "undoEdit") {
        reply(message.id, edits.toggle(message.batch, "done"));
      }
      if (message.t === "request" && message.op === "redoEdit") {
        reply(message.id, edits.toggle(message.batch, "undone"));
      }
      if (message.t === "release") trees.delete(message.id);
    },
    onMessage: (next) => {
      handler = next;
    },
    log: () => {},
    exit: () => {},
  });
  say({ t: "hello", map: MAP, pluginDir: PLUGIN, isVscode: false });

  let counter = 0;
  const values = (id: string) =>
    sent.flatMap((message) => (message.t === "next" && message.id === id ? [message.value] : []));

  /** Вызов до первого ответа. */
  const call = async <T>(method: string, args: unknown): Promise<T> => {
    const id = `c${++counter}`;
    say({ t: "call", id, method, args });
    for (let step = 0; step < 500; step++) {
      const failed = sent.find((message) => message.t === "error" && message.id === id);
      if (failed?.t === "error") throw new Error(failed.message);
      const [value] = values(id);
      if (value !== undefined) return value as T;
      // oxlint-disable-next-line no-await-in-loop
      await tick();
    }
    throw new Error("плагин не ответил");
  };

  /** Подписка: все значения потока, пока не отписались. */
  const watch = (method: string, args: unknown) => {
    const id = `c${++counter}`;
    say({ t: "call", id, method, args });
    return {
      values: () => values(id) as ObjectsMap[],
      until: async (check: (value: ObjectsMap) => boolean) => {
        for (let step = 0; step < 500; step++) {
          const last = values(id).at(-1) as ObjectsMap | undefined;
          if (last && check(last)) return last;
          // oxlint-disable-next-line no-await-in-loop
          await tick();
        }
        throw new Error(`не дождались: ${JSON.stringify(values(id).at(-1))}`);
      },
      stop: () => say({ t: "cancel", id }),
    };
  };
  return { call, watch, trees };
}

const start = () => ({
  "/map/systems/bank/_index.json": '{ "name": "Банк" }\n',
  "/map/_metrics/canvas/config.json": "{}\n",
  // Полка связей: папка без `_index.json`.
  "/map/relations/.keep": "",
});

test("view: вьюха из карты и map-state.json, и она же после правки, без перезапроса", async () => {
  const files: Record<string, string> = {
    ...start(),
    "/map/_metrics/canvas/map-state.json": JSON.stringify({
      positions: { "mapward://systems/bank": { x: 5, y: 6 } },
    }),
  };
  const { call, watch } = platform(files);

  const stream = watch("view", { view: VIEW });
  const first = await stream.until((value) => value.nodes.length === 1);
  expect(first.view).toBe(VIEW);
  expect(first.nodes[0]).toMatchObject({ id: "mapward://systems/bank", label: "Банк" });
  expect(first.nodes[0]?.position).toEqual({ x: 5, y: 6 });
  expect(first.canPlaceObjects).toBe(true);

  const moved = await call<EditResult>("edit", {
    view: VIEW,
    ops: [{ op: "move-nodes", positions: { "mapward://systems/bank": { x: 40, y: 50 } } }],
  });
  expect(moved.ok).toBe(true);
  const after = await stream.until((value) => value.nodes[0]?.position?.x === 40);
  expect(after.nodes[0]?.position).toEqual({ x: 40, y: 50 });
  stream.stop();
});

test("edit: объект и стрелка к нему — одной пачкой; отмена убирает оба, повтор возвращает", async () => {
  const files: Record<string, string> = start();
  const { call } = platform(files);

  const done = await call<EditResult>("edit", {
    view: VIEW,
    ops: [
      { op: "create-object", name: "Склад", position: { x: 1, y: 2 } },
      { op: "create-relation", from: "mapward://systems/bank", to: "mapward://systems/склад" },
    ],
  });
  if (!done.ok) throw new Error(done.error);
  expect(JSON.parse(files["/map/systems/склад/_index.json"] ?? "{}").name).toBe("Склад");
  expect(JSON.parse(files["/map/relations/bank-to-склад/_index.json"] ?? "{}").props).toEqual({
    from: "mapward://systems/bank",
    to: "mapward://systems/склад",
  });
  expect(files["/map/_metrics/canvas/map-state.json"]).toContain('"x": 1');

  expect(await call<EditResult>("undo", { id: done.id })).toMatchObject({ ok: true });
  expect(files["/map/systems/склад/_index.json"]).toBeUndefined();
  expect(files["/map/relations/bank-to-склад/_index.json"]).toBeUndefined();

  expect(await call<EditResult>("redo", { id: done.id })).toMatchObject({ ok: true });
  expect(files["/map/systems/склад/_index.json"]).toContain("Склад");
  expect(await call<EditResult>("redo", { id: done.id })).toEqual({
    ok: false,
    error: `Пачка ${done.id} не отменена`,
  });
});

test("edit: удалённый объект ждёт в корзине пачки, а отказ операции откатывает всю пачку", async () => {
  const files: Record<string, string> = {
    ...start(),
    "/map/systems/bank/Purpose.md": "зачем",
  };
  const { call } = platform(files);

  const removed = await call<EditResult>("edit", {
    ops: [{ op: "delete-object", object: "mapward://systems/bank" }],
  });
  if (!removed.ok) throw new Error(removed.error);
  expect(files["/map/systems/bank/Purpose.md"]).toBeUndefined();
  // Корзина — у правки карты платформы: под номером её пачки, а не пачки холста.
  expect(
    Object.entries(files).find(([file]) => file.endsWith("/systems/bank/Purpose.md"))?.[0],
  ).toMatch(/^\/map\/\.mapward\/trash\/m\d+\//);
  await call<EditResult>("undo", { id: removed.id });
  expect(files["/map/systems/bank/Purpose.md"]).toBe("зачем");

  const refused = await call<EditResult>("edit", {
    view: VIEW,
    ops: [
      { op: "create-object", name: "Склад" },
      { op: "create-relation", from: "mapward://systems/bank", to: "mapward://nowhere" },
    ],
  });
  expect(refused).toEqual({
    ok: false,
    error: "Операция 2 (create-relation): Нет объекта mapward://nowhere",
  });
  expect(files["/map/systems/склад/_index.json"]).toBeUndefined();
});

test("edit: операция не того вида — отказ по схеме ещё до вызова, диск не тронут", async () => {
  const files: Record<string, string> = start();
  const { call } = platform(files);
  const before = { ...files };

  await expect(call<EditResult>("edit", { view: VIEW, ops: [{ op: "explode" }] })).rejects.toThrow(
    /^аргументы edit не по схеме: \/ops\/0/,
  );
  expect(files).toEqual(before);
});
