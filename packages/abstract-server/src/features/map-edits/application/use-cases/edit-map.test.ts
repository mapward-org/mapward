import { expect, test } from "vitest";
import { contentVersion, findObject, MAP_ROOT } from "@mapward/core";
import type { CheckReport, ComponentBuild, MapEditOp, MapEditResult } from "@mapward/core";
import type { PluginDescription } from "@mapward/plugin";
import type { FileEntry, FileMover, FilesPort } from "../../../../ports/index.ts";
import { ActionConfig, MapModel, MetricConfig, ObjectIndex } from "../../../map/index.ts";
import type { MapEditsBuilds, MapEditsPlugins } from "../../ports.ts";
import { ApplySteps } from "../services/apply-steps.ts";
import { CheckTarget } from "../services/check-target.ts";
import { EditHistory } from "../services/edit-history.ts";
import { FieldOps } from "../services/field-ops.ts";
import { EditMap } from "./edit-map.ts";
import { ToggleEdit } from "./toggle-edit.ts";

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

/**
 * Диск в памяти с папками, как у настоящего: запись создаёт папки на пути, удаление файла папку
 * оставляет, перенос несёт всё, что под папкой, и саму папку — даже пустую.
 */
function fakeFiles(tree: Record<string, string>, dirs = new Set<string>()) {
  const mkdirs = (path: string) => {
    for (let dir = parentOf(path); dir.length > 1; dir = parentOf(dir)) dirs.add(dir);
  };
  for (const path of Object.keys(tree)) mkdirs(path);
  const files: FilesPort & FileMover = {
    read: (path) => Promise.resolve(tree[path]),
    list: (dir) => {
      const names = new Map<string, boolean>();
      for (const path of Object.keys(tree)) {
        if (parentOf(path) === dir) names.set(path.slice(dir.length + 1), false);
      }
      for (const path of dirs) {
        if (parentOf(path) === dir) names.set(path.slice(dir.length + 1), true);
      }
      return Promise.resolve(
        [...names].map(([name, isDirectory]): FileEntry => ({ name, isDirectory })),
      );
    },
    write: (path, text) => {
      mkdirs(path);
      tree[path] = text;
      return Promise.resolve();
    },
    remove: (path) => {
      delete tree[path];
      return Promise.resolve();
    },
    move: (from, to) => {
      mkdirs(to);
      for (const path of Object.keys(tree)) {
        if (!under(path, from)) continue;
        tree[to + path.slice(from.length)] = tree[path] ?? "";
        delete tree[path];
      }
      for (const dir of Array.from(dirs)) {
        if (!under(dir, from)) continue;
        dirs.delete(dir);
        dirs.add(to + dir.slice(from.length));
      }
      return Promise.resolve();
    },
    watch: () => () => undefined,
    realpath: (path) => Promise.resolve(path),
  };
  return { files, dirs };
}

const ref = { mapPath: "/map", basePath: "/", name: "Карта" };
const timers = { every: () => () => undefined, after: () => () => undefined };
const clock = { now: () => new Date().toISOString() };

/** Встроенный `views` — как его описывает плагин: шаблоны видов и агент из `params.source`. */
const VIEW_PARAMS = {
  type: "object",
  properties: {
    source: {
      type: "object",
      required: ["plugin", "method"],
      properties: { plugin: { type: "string" }, method: { type: "string" }, params: {} },
    },
    data: {},
    empty: { type: "string" },
  },
  additionalProperties: false,
};
const plugins: Record<string, PluginDescription> = {
  "/map/_plugins/views": {
    activation: {},
    methods: {},
    templates: {
      list: { component: "list.tsx", params: VIEW_PARAMS, agent: { param: "source" } },
    },
  },
  "/map/_plugins/shell": {
    activation: {},
    methods: {
      json: {
        kind: "query",
        params: {
          type: "object",
          required: ["command"],
          properties: { command: { type: "string" } },
        },
      },
      run: {
        kind: "mutation",
        params: {
          type: "object",
          required: ["command", "cwd"],
          properties: { command: { type: "string" }, cwd: { type: "string" } },
        },
      },
    },
  },
};

/** Сервер как в сборке: живая модель карты, правка и отмена поверх одного диска. */
function setup(tree: Record<string, string>, builds: Partial<MapEditsBuilds> = {}) {
  const { files, dirs } = fakeFiles(tree);
  const model = new MapModel(files, files, timers, clock);
  const source = {
    current: async () => {
      const root = await model.subtree(ref, MAP_ROOT, Infinity);
      if (!root) throw new Error("карта не читается");
      return root;
    },
    refresh: (paths: string[]) => model.refresh(paths),
  };
  const apply = new ApplySteps(files, files, files, source);
  const history = new EditHistory();
  const asked: unknown[] = [];
  const editPlugins: MapEditsPlugins = {
    describe: (_ref, plugin) => {
      const found = plugins[plugin];
      return found ? Promise.resolve(found) : Promise.reject(new Error(`нет ${plugin}`));
    },
    first: (_ref, plugin, method, args) => {
      asked.push({ plugin, method, args });
      return Promise.resolve(["ответ"]);
    },
    check: (_ref, plugin): Promise<CheckReport> =>
      Promise.resolve({ target: plugin, ok: true, steps: [] }),
    installDeps: () => Promise.resolve({ error: "нет сети — npm не достучался до реестра" }),
  };
  const ok: ComponentBuild = { code: "x", builtAt: "" };
  const checks = new CheckTarget(
    {
      metric: () => Promise.resolve(ok),
      layout: () => Promise.resolve(ok),
      actionForm: () => Promise.resolve(ok),
      ...builds,
    },
    editPlugins,
  );
  const fields = new FieldOps(
    files,
    { object: ObjectIndex, metric: MetricConfig, action: ActionConfig },
    editPlugins,
  );
  const edit = new EditMap(source, files, apply, history, fields, checks, editPlugins);
  return {
    model: () => source.current(),
    edit,
    run: (...ops: MapEditOp[]) => edit.run(ref, ops),
    undo: new ToggleEdit(apply, history, "done"),
    redo: new ToggleEdit(apply, history, "undone"),
    dirs,
    asked,
  };
}

/** Удача пачки — или падение теста с причиной. */
function done(result: MapEditResult) {
  if (!result.ok) throw new Error(`${result.error} ${JSON.stringify(result.errors ?? [])}`);
  return result;
}

const start = (): Record<string, string> => ({
  "/map/_index.json": '{ "name": "Карта" }\n',
  "/map/prototypes/service/_index.json": '{ "name": "Сервис" }\n',
  "/map/systems/shop/_index.json":
    '{ "name": "Магазин", "extends": "mapward://prototypes/service" }\n',
  "/map/systems/shop/_metrics/load/config.json":
    '{ "label": "нагрузка", "params": { "of": { "deep": ["mapward://prototypes/service#name"] } } }\n',
  "/map/systems/bank/_index.json": '{ "name": "Банк" }\n',
  "/map/links/shop-to-bank/_index.json":
    '{ "name": "зовёт", "props": { "from": "mapward://systems/shop", "to": "mapward://systems/bank" } }\n',
  "/map/systems/shop/_directives/note.md": "про mapward://prototypes/service",
  "/map/_plugins/views/index.ts": "export default {}",
  "/map/_plugins/views/list.tsx": "export default () => null",
  "/map/_plugins/shell/index.ts": "export default {}",
});

test("create and move in one batch: the model sees each step, addresses follow everywhere", async () => {
  const tree = start();
  const { run, model } = setup(tree);
  // Читали модель до правки — она должна увидеть своё без вотчера.
  expect(findObject(await model(), "mapward://catalog")).toBeUndefined();

  const result = done(
    await run(
      { op: "create", parent: MAP_ROOT, content: { name: "Catalog" } },
      { op: "move", object: "mapward://prototypes/service", parent: "mapward://catalog" },
      { op: "move", object: "mapward://systems/shop", parent: "mapward://catalog" },
    ),
  );
  expect(result.created).toEqual(["mapward://catalog"]);
  expect(result.results[0]).toEqual({ address: "mapward://catalog" });
  expect(result.moves).toEqual([
    { from: "mapward://prototypes/service", to: "mapward://catalog/service" },
    { from: "mapward://systems/shop", to: "mapward://catalog/shop" },
  ]);

  // `extends`, вложенное значение конфига с полем после `#`, концы связи в `props`.
  expect(tree["/map/catalog/shop/_index.json"]).toContain('"extends": "mapward://catalog/service"');
  expect(tree["/map/catalog/shop/_metrics/load/config.json"]).toContain(
    '"mapward://catalog/service#name"',
  );
  expect(tree["/map/links/shop-to-bank/_index.json"]).toContain('"from": "mapward://catalog/shop"');
  // Текст директивы правка не трогает, хоть она и переехала с папкой.
  expect(tree["/map/catalog/shop/_directives/note.md"]).toBe("про mapward://prototypes/service");

  const after = await model();
  expect(findObject(after, "mapward://catalog/shop")?.name).toBe("Магазин");
  expect(findObject(after, "mapward://systems/shop")).toBeUndefined();
});

test("delete goes to the batch trash; undo brings it back, redo takes it again", async () => {
  const tree = start();
  const { run, undo, redo, model } = setup(tree);
  await model();
  const removed = done(await run({ op: "delete", address: "mapward://systems/bank" }));
  expect(tree["/map/systems/bank/_index.json"]).toBeUndefined();
  expect(tree[`/map/.mapward/trash/${removed.id}/systems/bank/_index.json`]).toContain("Банк");
  expect(findObject(await model(), "mapward://systems/bank")).toBeUndefined();

  expect(await undo.run(ref, removed.id)).toMatchObject({ ok: true });
  expect(findObject(await model(), "mapward://systems/bank")?.name).toBe("Банк");
  expect(await undo.run(ref, removed.id)).toEqual({
    ok: false,
    error: `Пачка ${removed.id} уже отменена`,
  });
  expect(await redo.run(ref, removed.id)).toMatchObject({ ok: true });
  expect(tree["/map/systems/bank/_index.json"]).toBeUndefined();
});

test("undo of a move answers with the moves back; a refused op rolls the whole batch back", async () => {
  const tree = start();
  const { run, undo } = setup(tree);
  const moved = done(
    await run({ op: "setFolder", object: "mapward://systems/bank", folder: "Центробанк" }),
  );
  expect(tree["/map/links/shop-to-bank/_index.json"]).toContain(
    '"to": "mapward://systems/центробанк"',
  );
  expect(await undo.run(ref, moved.id)).toMatchObject({
    ok: true,
    moves: [{ from: "mapward://systems/центробанк", to: "mapward://systems/bank" }],
  });
  expect(tree["/map/links/shop-to-bank/_index.json"]).toContain('"to": "mapward://systems/bank"');

  const before = { ...tree };
  expect(
    await run(
      { op: "set", address: "mapward://systems/bank", content: { name: "Банк 2" } },
      { op: "move", object: "mapward://systems/shop", parent: "mapward://nowhere" },
    ),
  ).toEqual({
    ok: false,
    error: "Операция 2 (move): Нет объекта mapward://nowhere, куда переносить",
  });
  expect(tree).toEqual(before);
});

test("get gives the own index as written; set replaces it whole; a stale version is refused", async () => {
  const tree = start();
  const { run, model } = setup(tree);
  const [got] = done(await run({ op: "get", address: "mapward://systems/shop" })).results as {
    content: unknown;
    version: string;
  }[];
  // Своё, без наследования: имени прототипа и его полей здесь нет.
  expect(got).toMatchObject({
    content: { name: "Магазин", extends: "mapward://prototypes/service" },
    version: contentVersion(tree["/map/systems/shop/_index.json"] ?? ""),
  });

  done(
    await run({
      op: "set",
      address: "mapward://systems/shop",
      content: { name: "Лавка", props: { rps: 3 } },
      version: got?.version,
    }),
  );
  // Полная замена: `extends` не было в новом — его нет и в файле.
  expect(JSON.parse(tree["/map/systems/shop/_index.json"] ?? "")).toEqual({
    name: "Лавка",
    props: { rps: 3 },
  });
  expect(findObject(await model(), "mapward://systems/shop")?.name).toBe("Лавка");

  const stale = await run({
    op: "set",
    address: "mapward://systems/shop",
    content: { name: "Поверх" },
    version: got?.version,
  });
  expect(stale).toMatchObject({
    ok: false,
    current: { content: { name: "Лавка", props: { rps: 3 } } },
  });
  expect(tree["/map/systems/shop/_index.json"]).toContain("Лавка");
});

test("a schema error names the field path and what was expected; extends must be an object", async () => {
  const { run } = setup(start());
  const wrong = await run({
    op: "set",
    address: "mapward://systems/bank",
    content: { name: 5, extends: "mapward://nowhere", "metric-groups": { groups: [{}] } },
  });
  expect(wrong.ok).toBe(false);
  const errors = wrong.ok ? [] : (wrong.errors ?? []);
  expect(errors.some((line) => line.startsWith("/name:"))).toBe(true);
  expect(errors.some((line) => line.startsWith("/metric-groups/groups/0"))).toBe(true);
  const missing = await run({
    op: "set",
    address: "mapward://systems/bank",
    content: { name: "Банк", extends: "mapward://nowhere" },
  });
  expect(missing).toMatchObject({ ok: false, errors: ["/extends: нет объекта mapward://nowhere"] });
});

test("a metric by a views template: the short form unfolds into component and agent", async () => {
  const tree = start();
  const { run, model } = setup(tree);
  const source = {
    plugin: "${{ mapward:// }}/_plugins/shell",
    method: "json",
    params: { command: "ls" },
  };
  const result = done(
    await run({
      op: "set",
      address: "mapward://systems/bank/_metrics/files",
      content: { label: "Файлы", plugin: "_plugins/views", template: "list", params: { source } },
    }),
  );
  expect(result.results[0]).toMatchObject({ created: true });
  expect(JSON.parse(tree["/map/systems/bank/_metrics/files/config.json"] ?? "")).toEqual({
    label: "Файлы",
    component: "${{ mapward:// }}/_plugins/views/list.tsx",
    params: { source },
    agent: source,
  });
  const bank = findObject(await model(), "mapward://systems/bank");
  expect(bank?.metrics.map((metric) => metric.config.component)).toEqual([
    "/map/_plugins/views/list.tsx",
  ]);

  const bad = await run({
    op: "set",
    address: "mapward://systems/bank/_metrics/files",
    content: { plugin: "_plugins/views", template: "list", params: { sauce: 1 } },
  });
  expect(bad).toMatchObject({ ok: false });
  expect(bad.ok ? [] : bad.errors).toEqual([expect.stringMatching(/^\/params: .*additional/i)]);
  const unknown = await run({
    op: "set",
    address: "mapward://systems/bank/_metrics/files",
    content: { plugin: "_plugins/views", template: "pie", params: {} },
  });
  expect(unknown).toMatchObject({
    ok: false,
    errors: ["/template: у плагина нет шаблона pie; есть: list"],
  });
});

test("a metric in full form: the component file, the agent's plugin, method and params are checked", async () => {
  const { run } = setup(start());
  const wrong = await run({
    op: "set",
    address: "mapward://systems/bank/_metrics/x",
    content: {
      component: "./nope.tsx",
      params: { source: { plugin: "p", method: "m" }, empty: "${{ mapward://~#props.x }}" },
      agent: { plugin: "${{ mapward:// }}/_plugins/shell", method: "json", params: { command: 1 } },
    },
  });
  expect(wrong.ok ? [] : wrong.errors).toEqual([
    "/component: файла нет: /map/systems/bank/_metrics/x/nope.tsx",
    expect.stringMatching(/^\/agent\/params\/command: /),
  ]);
  const template = await run({
    op: "set",
    address: "mapward://systems/bank/_metrics/x",
    content: { component: "../../../../_plugins/views/list.tsx", params: { extra: true } },
  });
  // Компонент — шаблон плагина: `params` проверяются его схемой и в полной форме.
  expect(template.ok ? [] : template.errors).toEqual([
    expect.stringMatching(/^\/params: .*additional/i),
  ]);
  const method = await run({
    op: "set",
    address: "mapward://systems/bank/_metrics/x",
    content: { agent: { plugin: "${{ mapward:// }}/_plugins/shell", method: "nope" } },
  });
  expect(method.ok ? [] : method.errors).toEqual([
    "/agent/method: у плагина нет метода nope; есть: json, run",
  ]);
});

test("an action: plugin, a mutating method and params by its schema, the form fills the rest", async () => {
  const tree = start();
  const { run } = setup(tree);
  const reading = await run({
    op: "set",
    address: "mapward://systems/bank/_actions/list",
    content: { label: "Список", plugin: "${{ mapward:// }}/_plugins/shell", method: "json" },
  });
  expect(reading.ok ? [] : reading.errors).toEqual([
    "/method: json читающий, а экшон зовёт изменяющий",
  ]);
  done(
    await run({
      op: "set",
      address: "mapward://systems/bank/_actions/deploy",
      content: {
        label: "Выкатить",
        confirm: true,
        plugin: "${{ mapward:// }}/_plugins/shell",
        method: "run",
        params: { command: "deploy" },
      },
    }),
  );
  expect(tree["/map/systems/bank/_actions/deploy/config.json"]).toContain('"method": "run"');
  const typed = await run({
    op: "set",
    address: "mapward://systems/bank/_actions/deploy",
    content: { plugin: "${{ mapward:// }}/_plugins/shell", method: "run", params: { command: 1 } },
  });
  expect(typed.ok ? [] : typed.errors).toEqual([expect.stringMatching(/^\/params\/command: /)]);
});

test("a workflow stage: set writes frontmatter and text, get reads them back", async () => {
  const tree = start();
  const { run, model } = setup(tree);
  done(
    await run({
      op: "set",
      address: "mapward://prototypes/service/_directives.workflow/выпуск",
      content: { name: "Выпуск", order: 50, marksDone: true, text: "Выпусти версию." },
    }),
  );
  expect(tree["/map/prototypes/service/_directives.workflow/выпуск.md"]).toBe(
    "---\nname: Выпуск\norder: 50\nmarks-done: true\n---\n\nВыпусти версию.\n",
  );
  const stage = findObject(await model(), "mapward://prototypes/service")?.workflow.find(
    (one) => one.name === "Выпуск",
  );
  expect(stage).toMatchObject({ order: 50, marksDone: true });
  expect(
    done(
      await run({ op: "get", address: "mapward://prototypes/service/_directives.workflow/выпуск" }),
    ).results[0],
  ).toMatchObject({
    content: { name: "Выпуск", order: 50, marksDone: true, text: "Выпусти версию.\n" },
  });
  expect(
    await run({
      op: "set",
      address: "mapward://prototypes/service/_directives.workflow/x",
      content: { name: "X" },
    }),
  ).toMatchObject({ ok: false, errors: [expect.stringMatching(/^\/: .*order/)] });

  done(
    await run({
      op: "delete",
      address: "mapward://prototypes/service/_directives.workflow/выпуск",
    }),
  );
  expect(tree["/map/prototypes/service/_directives.workflow/выпуск.md"]).toBeUndefined();
});

test("a shared layer: get and set by the folder address, a new one only by kind: layer", async () => {
  const tree = start();
  const { run } = setup(tree);
  const content = { label: "Общая", component: "${{ mapward:// }}/_plugins/views/list.tsx" };
  expect(await run({ op: "set", address: "mapward://shared/files", content })).toMatchObject({
    ok: false,
  });
  done(await run({ op: "set", address: "mapward://shared/files", content, kind: "layer" }));
  expect(JSON.parse(tree["/map/shared/files/config.json"] ?? "")).toEqual(content);
  done(
    await run({
      op: "set",
      address: "mapward://systems/bank/_metrics/files",
      content: { extends: "mapward://shared/files" },
    }),
  );
  expect(
    done(await run({ op: "get", address: "mapward://shared/files" })).results[0],
  ).toMatchObject({ content });
  expect(
    await run({
      op: "set",
      address: "mapward://systems/bank/_metrics/other",
      content: { extends: "mapward://shared/nothing" },
    }),
  ).toMatchObject({
    ok: false,
    errors: ["/extends: по адресу mapward://shared/nothing нет config.json"],
  });

  done(
    await run(
      { op: "delete", address: "mapward://systems/bank/_metrics/files" },
      { op: "delete", address: "mapward://shared/files" },
    ),
  );
  expect(tree["/map/shared/files/config.json"]).toBeUndefined();
  expect(tree["/map/systems/bank/_metrics/files/config.json"]).toBeUndefined();
});

test("a shelf becomes an object by its index, and an object a shelf by keepChildren", async () => {
  const tree = start();
  const { run, model, undo } = setup(tree);
  expect(await run({ op: "get", address: "mapward://systems" })).toMatchObject({ ok: false });
  done(await run({ op: "set", address: "mapward://systems", content: { name: "Системы" } }));
  expect(findObject(await model(), "mapward://systems")).toMatchObject({
    isGroup: false,
    name: "Системы",
  });

  // На магазин ссылается связь — полкой он не станет, пока ссылка есть.
  expect(
    await run({ op: "delete", address: "mapward://systems/shop", keepChildren: true }),
  ).toEqual({
    ok: false,
    error:
      "На mapward://systems/shop ссылаются: /map/links/shop-to-bank/_index.json — полкой его не сделать",
  });

  done(
    await run(
      { op: "delete", address: "mapward://links/shop-to-bank" },
      {
        op: "create",
        parent: "mapward://systems/shop",
        folder: "cart",
        content: { name: "Корзина" },
      },
    ),
  );
  const shelved = done(
    await run({ op: "delete", address: "mapward://systems/shop", keepChildren: true }),
  );
  expect(tree["/map/systems/shop/_index.json"]).toBeUndefined();
  expect(tree["/map/systems/shop/_metrics/load/config.json"]).toBeUndefined();
  expect(tree["/map/systems/shop/_directives/note.md"]).toBeUndefined();
  expect(tree["/map/systems/shop/cart/_index.json"]).toContain("Корзина");
  const after = await model();
  expect(findObject(after, "mapward://systems/shop")?.isGroup).toBe(true);
  expect(findObject(after, "mapward://systems/shop/cart")?.name).toBe("Корзина");

  expect(await undo.run(ref, shelved.id)).toMatchObject({ ok: true });
  expect(tree["/map/systems/shop/_metrics/load/config.json"]).toContain("нагрузка");
  expect(findObject(await model(), "mapward://systems/shop")?.isGroup).toBe(false);
});

test("deleting a shelf with objects inside needs recursive: true", async () => {
  const tree = start();
  const { run } = setup(tree);
  expect(await run({ op: "delete", address: "mapward://systems" })).toEqual({
    ok: false,
    error:
      "В полке mapward://systems есть объекты: mapward://systems/bank, mapward://systems/shop. Унеси их или удали с recursive: true",
  });
  done(await run({ op: "delete", address: "mapward://systems", recursive: true }));
  expect(Object.keys(tree).some((path) => path.startsWith("/map/systems/"))).toBe(false);
});

test("folders are implicit: create and writeFile make them, an emptied folder goes up the path", async () => {
  const tree = start();
  const { run, undo, dirs, model } = setup(tree);
  const made = done(
    await run(
      { op: "create", parent: "mapward://deep/er", content: { name: "Глубокий" } },
      { op: "writeFile", path: "docs/notes/readme.md", text: "# заметки" },
    ),
  );
  expect(made.created).toEqual(["mapward://deep/er/глубокий"]);
  expect(tree["/map/deep/er/глубокий/_index.json"]).toContain("Глубокий");
  expect(tree["/map/docs/notes/readme.md"]).toBe("# заметки");
  expect(findObject(await model(), "mapward://deep/er/глубокий")?.name).toBe("Глубокий");

  // Удалили единственный объект — опустевшие `er` и `deep` уходят следом.
  const removed = done(await run({ op: "delete", address: "mapward://deep/er/глубокий" }));
  expect(dirs.has("/map/deep/er")).toBe(false);
  expect(dirs.has("/map/deep")).toBe(false);
  expect(findObject(await model(), "mapward://deep")).toBeUndefined();
  // Отмена возвращает и папки.
  done(await undo.run(ref, removed.id));
  expect(dirs.has("/map/deep/er")).toBe(true);
  expect(tree["/map/deep/er/глубокий/_index.json"]).toContain("Глубокий");

  // Папка с доками без объектов остаётся: она не пустая.
  tree["/map/docs/notes/old.md"] = "старое";
  done(await run({ op: "removeFile", path: "docs/notes/readme.md" }));
  expect(dirs.has("/map/docs/notes")).toBe(true);
  done(await run({ op: "removeFile", path: "/map/docs/notes/old.md" }));
  expect(dirs.has("/map/docs")).toBe(false);

  // Перенос оставил папку пустой — она уходит так же.
  done(await run({ op: "move", object: "mapward://deep/er/глубокий", parent: MAP_ROOT }));
  expect(dirs.has("/map/deep")).toBe(false);
  expect(tree["/map/глубокий/_index.json"]).toContain("Глубокий");
});

test("raw files: read with a version, write over a stale one is refused, platform's own is off-limits", async () => {
  const tree = start();
  const { run } = setup(tree);
  const read = done(await run({ op: "readFile", path: "systems/shop/_directives/note.md" }));
  expect(read.results[0]).toEqual({
    path: "/map/systems/shop/_directives/note.md",
    text: "про mapward://prototypes/service",
    version: contentVersion("про mapward://prototypes/service"),
  });
  tree["/map/systems/shop/_directives/note.md"] = "кто-то поправил";
  expect(
    await run({
      op: "writeFile",
      path: "systems/shop/_directives/note.md",
      text: "моё",
      version: contentVersion("про mapward://prototypes/service"),
    }),
  ).toMatchObject({ ok: false, current: { text: "кто-то поправил" } });

  for (const path of [
    ".mapward/trash/x.json",
    "systems/_directives.state/a.json",
    "../outside.md",
  ]) {
    // oxlint-disable-next-line no-await-in-loop
    expect(await run({ op: "writeFile", path, text: "x" })).toMatchObject({ ok: false });
  }
  expect(tree["/map/.mapward/trash/x.json"]).toBeUndefined();
  expect(done(await run({ op: "readFile", path: "nothing.md" })).results[0]).toEqual({
    path: "/map/nothing.md",
    text: null,
    version: null,
  });
});

test("check by a metric builds its component and asks the agent request; a broken one names the place", async () => {
  const tree = start();
  tree["/map/systems/bank/_metrics/broken/config.json"] = JSON.stringify({
    component: "./view.tsx",
    agent: { plugin: "/map/_plugins/shell", method: "json", params: { command: "ls" } },
  });
  tree["/map/systems/bank/_metrics/broken/view.tsx"] = "export default (";
  const { run, asked } = setup(tree, {
    metric: () =>
      Promise.resolve({
        errors: ["/map/systems/bank/_metrics/broken/view.tsx:1:16: ERROR: Unexpected end of file"],
        builtAt: "",
      }),
  });
  const [report] = done(
    await run({ op: "check", address: "mapward://systems/bank/_metrics/broken" }),
  ).results as CheckReport[];
  expect(report).toEqual({
    target: "mapward://systems/bank/_metrics/broken",
    ok: false,
    steps: [
      {
        title: "метрика mapward://systems/bank/_metrics/broken: компонент",
        status: "fail",
        lines: ["/map/systems/bank/_metrics/broken/view.tsx:1:16: ERROR: Unexpected end of file"],
      },
      {
        title: "метрика mapward://systems/bank/_metrics/broken: запрос для агента",
        status: "ok",
        lines: ['json ответил: ["ответ"]'],
      },
    ],
  });
  expect(asked).toEqual([
    { plugin: "/map/_plugins/shell", method: "json", args: { command: "ls" } },
  ]);
  // Папка плагина — проверка плагина; без сети зависимости не ставятся, и отказ это называет.
  expect(done(await run({ op: "check", address: "_plugins/shell" })).results[0]).toEqual({
    target: "_plugins/shell",
    ok: true,
    steps: [],
  });
  expect(await run({ op: "installDeps", plugin: "_plugins/shell" })).toEqual({
    ok: false,
    error: "нет сети — npm не достучался до реестра",
  });
});
