import { expect, test } from "vitest";
import type { FilesPort, ServerPorts } from "../ports/index.ts";
import { createMapServer } from "./server.ts";
import { serveMcp, type McpTransport } from "./mcp.ts";
import type { MapRef } from "../features/map-object/application/services/metric-store.ts";

/** Карта в памяти: MCP проверяется без редактора и без диска — решение 0014. */
function fakeFiles(tree: Record<string, string>): FilesPort {
  const paths = Object.keys(tree);
  return {
    read: (path) => Promise.resolve(tree[path]),
    list: (path) => {
      const prefix = `${path}/`;
      const names = new Map<string, boolean>();
      for (const candidate of paths) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) names.set(rest, false);
        else names.set(rest.slice(0, cut), true);
      }
      return Promise.resolve([...names].map(([name, isDirectory]) => ({ name, isDirectory })));
    },
    write: () => Promise.resolve(),
    remove: (path) => {
      delete tree[path];
      return Promise.resolve();
    },
    watch: () => () => undefined,
  };
}

const tree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/prototypes/_index.json": JSON.stringify({ name: "Прототипы" }),
  "/map/prototypes/package/_index.json": JSON.stringify({ name: "Пакет" }),
  "/map/prototypes/package/_actions/publish-version.md": "как выпускать версию",
  "/map/prototypes/package/_metrics/lint/config.json": JSON.stringify({
    label: "Линтер",
    collectors: [{ kind: "static", value: { ok: true } }],
    display: { kind: "status" },
  }),
  "/map/prototypes/package/_directives/create-package.md": "как заводить пакет",
  // Общая метрика лежит объектом: в её папке `config.json` и нет `_index.json`.
  "/map/prototypes/shared-files/config.json": JSON.stringify({
    label: "Файлы",
    collectors: [{ kind: "read-dir", basePath: "/repo" }],
    display: { kind: "tree" },
  }),
  // А у того, кто её подключил, в файле одна строка — ради неё слои и разделяют.
  "/map/prototypes/_metrics/files/config.json": JSON.stringify({
    extends: "mapward://prototypes/shared-files",
  }),
  "/map/packages/_index.json": JSON.stringify({ name: "Пакеты" }),
  "/map/packages/core/_index.json": JSON.stringify({
    name: "core",
    extends: "mapward://prototypes/package",
  }),
  "/map/packages/core/_actions/own.md": "свой экшон",
  "/map/packages/core/_metrics/version/config.json": JSON.stringify({
    label: "Версия",
    refresh: "on-display",
    collectors: [{ kind: "script", run: "echo hi" }],
    display: { kind: "text" },
  }),
  "/map/packages/core/_metrics/tests/config.json": JSON.stringify({
    label: "Тесты",
    collectors: [{ kind: "static", value: { text: "не должно собраться" } }],
    display: { kind: "text" },
  }),
  "/map/packages/core/_metrics/tests/collect.logs.json":
    'No projects matched the filter "@mapward/core"',
};

const ports: ServerPorts = {
  files: fakeFiles(tree),
  shell: {
    run: () => Promise.resolve({ stdout: '{"text":"0.0.0"}', stderr: "" }),
    pipe: () => Promise.resolve({ stdout: "{}", stderr: "" }),
  },
  agent: { run: () => Promise.resolve({ stdout: "{}", stderr: "" }) },
  clock: { now: () => new Date().toISOString() },
  timers: { every: () => () => undefined, after: () => () => undefined },
  env: { vars: () => ({}) },
  capabilities: { terminals: false, openFile: false, ask: false, virtualDocs: false },
};

const ref: MapRef = { mapPath: "/map", basePath: "/repo", name: "Карта" };

/** Зовёт инструмент и отдаёт разобранный ответ — протокол здесь не проверяется. */
async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const server = createMapServer(ports);
  let handler: ((message: unknown) => void) | undefined;
  const replies: Record<string, unknown>[] = [];

  const transport: McpTransport = {
    onMessage: (next) => {
      handler = next;
      return () => undefined;
    },
    send: (message) => replies.push(message as Record<string, unknown>),
  };

  serveMcp(server, [ref], transport);
  handler?.({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

  // Ответ уходит из промиса, поэтому ждём микротасками: прогон здесь весь на моках.
  for (let tick = 0; tick < 1000 && replies.length === 0; tick++) await Promise.resolve();

  const reply = replies[0];
  if (!reply) throw new Error("ответа не было");
  if (reply.error) throw new Error(String((reply.error as { message?: string }).message));

  const content = (reply.result as { content: { text: string }[] }).content;
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>;
}

test("read_object leads up the tree as well as down", async () => {
  const object = await call("read_object", { address: "mapward://packages/core" });

  // От ближайшего родителя к корню — по ним агент уходит к соседям, решение 0016.
  expect(object.parents).toEqual([
    { address: "mapward://packages", name: "Пакеты" },
    { address: "mapward://", name: "Карта" },
  ]);
});

test("the root has no parents", async () => {
  const object = await call("read_object", {});
  expect(object.parents).toEqual([]);
  expect(object.children).toEqual([
    { address: "mapward://prototypes", name: "Прототипы" },
    { address: "mapward://packages", name: "Пакеты" },
  ]);
});

test("an inherited file says where it actually lives", async () => {
  const object = await call("read_object", { address: "mapward://packages/core" });

  // Унаследованное правится у прототипа, и по ответу это должно быть видно — решение 0016.
  expect(object.directives).toEqual({
    total: 1,
    new: 1,
    changed: 0,
    done: 0,
    files: [
      {
        name: "create-package.md",
        path: "/map/prototypes/package/_directives/create-package.md",
        owner: "mapward://prototypes/package",
        status: "new",
      },
    ],
  });

  // Своё владельца не называет: поле значит «лежит не здесь».
  expect(object.actions).toEqual([
    {
      name: "publish-version.md",
      path: "/map/prototypes/package/_actions/publish-version.md",
      owner: "mapward://prototypes/package",
    },
    { name: "own.md", path: "/map/packages/core/_actions/own.md" },
  ]);
});

test("fields cut the answer down to what was asked for", async () => {
  const whole = await call("read_object", { address: "mapward://packages/core" });
  expect(whole.props).toBeDefined();
  expect((whole.metrics as { config?: unknown }[])[0]?.config).toBeDefined();

  const slim = await call("read_object", {
    address: "mapward://packages/core",
    fields: ["address", "metrics.key", "metrics.label"],
  });

  // Детей у core нет, и пустого списка в ответе тоже: `children: []` длину добавляет,
  // а ответа не даёт.
  expect(Object.keys(slim)).toEqual(["address", "metrics"]);
  expect(slim.metrics).toEqual([
    { key: "lint", label: "Линтер" },
    { key: "version", label: "Версия" },
    { key: "tests", label: "Тесты" },
  ]);
});

test("depth brings children as objects, not as names", async () => {
  const flat = await call("read_object", { address: "mapward://packages" });
  expect(flat.children).toEqual([{ address: "mapward://packages/core", name: "core" }]);

  const deep = await call("read_object", {
    address: "mapward://packages",
    depth: 1,
    fields: ["address", "metrics.key"],
  });

  // Те же поля на каждом уровне — глубина не требует удлинять проекцию.
  expect(deep).toEqual({
    address: "mapward://packages",
    metrics: [],
    children: [
      {
        address: "mapward://packages/core",
        metrics: [{ key: "lint" }, { key: "version" }, { key: "tests" }],
      },
    ],
  });
});

test("children the projection never touched are left out entirely", async () => {
  const named = await call("read_object", {
    address: "mapward://packages",
    depth: 1,
    fields: ["address"],
  });
  // Ребёнок назван: спрашивали адрес, адрес у него есть.
  expect(named.children).toEqual([{ address: "mapward://packages/core" }]);

  const untouched = await call("read_object", {
    address: "mapward://packages",
    depth: 1,
    fields: ["workflow"],
  });
  // Воркфлоу есть только у верхнего, у ребёнка проекции взять нечего — и списка `[{}]`
  // в ответе нет.
  expect(untouched.workflow).toBeDefined();
  expect(untouched.children).toBeUndefined();
});

test("the tool carries its own documentation", async () => {
  const index = await call("read_docs", {});

  // Оглавление первым делом: вываливать всю документацию в контекст незачем.
  const names = (index.sections as { name: string }[]).map((entry) => entry.name);
  expect(names[0]).toBe("README");
  expect(names).toContain("index-format");

  const doc = await call("read_docs", { section: "index-format" });
  expect(String(doc.text)).toContain("_index.json");
});

test("the shipped text mentions no decisions at all", async () => {
  const index = await call("read_docs", {});

  for (const { name } of index.sections as { name: string }[]) {
    const doc = await call("read_docs", { section: name });
    const text = String(doc.text);

    // Решений у установленного mapward нет. Номер без ссылки не лучше: он отсылает туда, куда
    // читателю не попасть. Текст объясняет сам — решение 0016.
    expect(text, name).not.toMatch(/\.\.\/decisions\//);
    expect(text, name).not.toMatch(/решени[ея]\s*`?0\d{3}/i);
    expect(text, name).not.toMatch(/\(\s*0\d{3}\s*\)/);
  }
});

test("metrics are picked by key, and the rest are not even collected", async () => {
  const all = await call("read_object", {
    address: "mapward://packages/core",
    refresh: "on-display",
  });
  expect((all.metrics as { key: string }[]).map((m) => m.key)).toEqual([
    "lint",
    "version",
    "tests",
  ]);

  const none = await call("read_object", {
    address: "mapward://packages/core",
    refresh: "on-display",
    metrics: [],
  });
  // Обзорный вызов: ни одной метрики, а значит и ни одного запущенного процесса.
  expect(none.metrics).toEqual([]);

  const one = await call("read_object", {
    address: "mapward://packages/core",
    refresh: "on-display",
    metrics: ["version"],
  });
  expect((one.metrics as { key: string; value?: { data?: unknown } }[])[0]?.value?.data).toEqual({
    text: "0.0.0",
  });
  expect(one.metrics).toHaveLength(1);
});

test("asking for metric fields with metrics turned off is refused, not answered with nothing", async () => {
  // Пустой список тут читается как «у объекта нет метрик», а это неправда — решение 0016.
  await expect(
    call("read_object", {
      address: "mapward://packages/core",
      metrics: [],
      fields: ["metrics.key"],
    }),
  ).rejects.toThrow(/вместе всегда пусто/);

  // Обзор без метрик остаётся законным: про метрики там и не спрашивают.
  const overview = await call("read_object", {
    address: "mapward://packages/core",
    metrics: [],
    fields: ["address"],
  });
  expect(overview.address).toBe("mapward://packages/core");

  // Перечень без сбора — это отсутствие отбора, а не пустой отбор.
  const keys = await call("read_object", {
    address: "mapward://packages/core",
    fields: ["metrics.key"],
  });
  expect((keys.metrics as { key: string }[]).map((m) => m.key)).toContain("version");
});

test("done directives stay out of the way until asked for", async () => {
  const quiet = await call("read_object", { address: "mapward://packages/core" });
  const digest = quiet.directives as { total: number; new: number; files: unknown[] };

  // Счётчики есть всегда, имена — только у того, что ещё не прогоняли.
  expect(digest.total).toBe(1);
  expect(digest.new).toBe(1);
  expect(digest.files).toHaveLength(1);

  const full = await call("read_object", {
    address: "mapward://packages/core",
    directives: "all",
  });
  expect((full.directives as { files: unknown[] }).files).toHaveLength(1);
});

test("a heavy answer loses its heaviest value, not itself", async () => {
  const fat = await call("read_object", {
    address: "mapward://packages/core",
    refresh: "on-display",
    budget: 200,
  });

  const version = (fat.metrics as { key: string; value?: unknown }[]).find(
    (m) => m.key === "version",
  );
  // Значение ушло, но ответ пришёл — и видно, что именно отрезали.
  expect(version?.value).toMatchObject({ truncated: true });
  expect(fat.address).toBe("mapward://packages/core");
});

test("an inherited metric says whose it is", async () => {
  const object = await call("read_object", {
    address: "mapward://packages/core",
    fields: ["metrics.key", "metrics.owner"],
  });

  // Инвариант 0015 спрашивает «метрика на своём объекте» — снаружи это видно только так.
  // Эффективный список у наследника одинаков с чужим, и без владельца об этом молчит.
  expect(object.metrics).toEqual([
    { key: "lint", owner: "mapward://prototypes/package" },
    { key: "version" },
    { key: "tests" },
  ]);

  const proto = await call("read_object", {
    address: "mapward://prototypes/package",
    fields: ["metrics.key", "metrics.owner"],
  });
  // У того, кто её завёл, владельца нет: поле значит «заведена не здесь».
  expect(proto.metrics).toEqual([{ key: "lint" }]);
});

test("logs come only when asked for", async () => {
  const quiet = await call("read_object", { address: "mapward://packages/core" });
  expect((quiet.metrics as Record<string, unknown>[])[0]?.logs).toBeUndefined();

  const loud = await call("read_object", {
    address: "mapward://packages/core",
    fields: ["metrics.key", "metrics.logs"],
  });

  // Почему метрика красная, написано в логах, а не во флаге ok.
  expect(loud.metrics).toContainEqual({
    key: "tests",
    logs: { collect: 'No projects matched the filter "@mapward/core"' },
  });
});

test("a directive can be read as text, wherever it lives", async () => {
  const body = await call("read_index", {
    address: "mapward://packages/core",
    file: "create-package.md",
  });

  // Файл лежит у прототипа, а спрашивают его у наследника — и это работает.
  expect(body.text).toBe("как заводить пакет");
  expect(body.owner).toBe("mapward://prototypes/package");

  await expect(
    call("read_index", { address: "mapward://packages/core", file: "нет-такого.md" }),
  ).rejects.toThrow(/Есть: create-package.md/);
});

test("a metric config is read raw, by the metric address", async () => {
  const layer = await call("read_index", { address: "mapward://packages/core/_metrics/lint" });

  // Конфиг лежит у прототипа — там его и правят, и по ответу это видно.
  expect(layer.configPath).toBe("/map/prototypes/package/_metrics/lint/config.json");
  expect(layer.owner).toBe("mapward://prototypes/package");
  expect(JSON.parse(layer.config as string)).toEqual({
    label: "Линтер",
    collectors: [{ kind: "static", value: { ok: true } }],
    display: { kind: "status" },
  });

  // Слоя над ним нет, и поля тоже нет: пустая ссылка была бы ответом на незаданный вопрос.
  expect(layer.extends).toBeUndefined();

  await expect(
    call("read_index", { address: "mapward://packages/core/_metrics/lint", file: "own.md" }),
  ).rejects.toThrow(/file и stage спрашивают у объекта/);
});

test("the next layer is named by address, not carried by value", async () => {
  const own = await call("read_index", { address: "mapward://prototypes/_metrics/files" });

  // Свой файл — одна строка `extends`; всё остальное лежит слоем выше.
  expect(JSON.parse(own.config as string)).toEqual({
    extends: "mapward://prototypes/shared-files",
  });
  expect(own.extends).toBe("mapward://prototypes/shared-files");

  // По названному адресу читается следующий слой — тем же вызовом, решение 0019.
  const parent = await call("read_index", { address: own.extends as string });
  expect(parent.index).toBeNull();
  expect(JSON.parse(parent.config as string)).toMatchObject({ label: "Файлы" });
  expect(parent.extends).toBeUndefined();
});

/**
 * Слои — решение 0019: из чего собран мердж, видно из того же ответа, а конфиг слоя берётся
 * по названному адресу. Без этого агент знает только, что мердж откуда-то взялся.
 */
test("the answer says which files the merge was put together from", async () => {
  const object = await call("read_object", {
    address: "mapward://packages/core",
    metrics: ["lint"],
    fields: ["layers", "metrics.key", "metrics.layers"],
  });

  expect(object.layers).toEqual([
    { address: "mapward://packages/core", path: "/map/packages/core/_index.json", from: "own" },
    {
      address: "mapward://prototypes/package",
      path: "/map/prototypes/package/_index.json",
      from: "prototype",
    },
  ]);

  // У метрики от прототипа свой слой прототипов, и путь ведёт туда, где её правят.
  expect(object.metrics).toEqual([
    {
      key: "lint",
      layers: [
        {
          address: "mapward://prototypes/package/_metrics/lint",
          path: "/map/prototypes/package/_metrics/lint/config.json",
          from: "prototype",
        },
      ],
    },
  ]);

  // Конфига слоя в ответе нет — есть адрес, по которому он читается.
  const shared = await call("read_object", {
    address: "mapward://prototypes",
    metrics: ["files"],
    fields: ["metrics.layers"],
  });
  expect(shared.metrics).toEqual([
    {
      layers: [
        {
          address: "mapward://prototypes/_metrics/files",
          path: "/map/prototypes/_metrics/files/config.json",
          from: "own",
        },
        {
          address: "mapward://prototypes/shared-files",
          path: "/map/prototypes/shared-files/config.json",
          from: "extends",
        },
      ],
    },
  ]);
});

test("an address answers with whatever the folder holds", async () => {
  const object = await call("read_index", { address: "mapward://packages/core" });

  expect(JSON.parse(object.index as string)).toMatchObject({ name: "core" });
  // Конфига в папке объекта нет — это ответ, а не умолчание.
  expect(object.config).toBeNull();
});

test("a map that is not there is named along with the ones that are", async () => {
  await expect(call("read_object", { map: "mapward://" })).rejects.toThrow(
    /Сервер отдаёт: «Карта»/,
  );
});

const metrics = (list: unknown) =>
  Object.fromEntries(
    (list as { key: string; value?: { data?: unknown } }[]).map((m) => [m.key, m.value?.data]),
  );

test("read_object fills cheap metrics only when asked", async () => {
  const quiet = await call("read_object", { address: "mapward://packages/core" });

  expect(metrics(quiet.metrics).version).toBeUndefined();

  const filled = await call("read_object", {
    address: "mapward://packages/core",
    refresh: "on-display",
  });

  expect(metrics(filled.metrics).version).toEqual({ text: "0.0.0" });
  // Дорогое ручное так не запускается ни у человека, ни у агента.
  expect(metrics(filled.metrics).tests).toBeUndefined();
});

/**
 * Запуск директивы — решение 0017: промпт этапа приходит вызовом, а состояние пишет сервер.
 * Записи здесь собираются, потому что проверяется именно то, что пишет карта, а не агент.
 */
const workflowTree = {
  "/map/_index.json": JSON.stringify({
    name: "Карта",
    "directives-workflow": { prompt: "и напиши отзыв" },
  }),
  "/map/_directives.workflow/обсудить.md":
    "---\nname: Обсудить\norder: 10\n---\n\nскажи, что думаешь\n",
  "/map/_directives.workflow/выполнить.md":
    "---\nname: Выполнить\norder: 20\nmarks-done: true\n---\n\nсделай\n",
  "/map/_directives/2026-09-20-0100-проба.md": "текст директивы",
};

async function callWith(
  disk: Record<string, string>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: Record<string, unknown>; writes: Record<string, string> }> {
  const writes: Record<string, string> = {};
  const files = fakeFiles(disk);
  const server = createMapServer({
    ...ports,
    files: {
      ...files,
      write: (path, text) => {
        writes[path] = text;
        disk[path] = text;
        return Promise.resolve();
      },
    },
  });

  let handler: ((message: unknown) => void) | undefined;
  const replies: Record<string, unknown>[] = [];
  serveMcp(server, [ref], {
    onMessage: (next) => {
      handler = next;
      return () => undefined;
    },
    send: (message) => replies.push(message as Record<string, unknown>),
  });
  handler?.({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  for (let tick = 0; tick < 1000 && replies.length === 0; tick++) await Promise.resolve();

  const reply = replies[0];
  if (!reply) throw new Error("ответа не было");
  if (reply.error) throw new Error(String((reply.error as { message?: string }).message));
  const content = (reply.result as { content: { text: string }[] }).content;
  return { result: JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>, writes };
}

const directive = { address: "mapward://", directive: "2026-09-20-0100-проба.md" };

test("run_directive gives the stage prompt and marks the run started", async () => {
  const { result, writes } = await callWith({ ...workflowTree }, "run_directive", {
    ...directive,
    stage: "Обсудить",
  });

  const prompt = String(result.prompt);
  expect(prompt).toContain("скажи, что думаешь");
  // Хук приклеен к промпту этапа, а не отправлен отдельно: для агента это один текст.
  expect(prompt).toContain("и напиши отзыв");
  // Голова про MCP одна на все этапы — без неё агент уходит сканировать репозиторий.
  expect(prompt).toContain("read_docs");

  const state = JSON.parse(
    writes["/map/_directives.state/2026-09-20-0100-проба.state.json"] ?? "{}",
  );
  expect(state.run.stage).toBe("Обсудить");
  expect(state.run.finishedAt).toBeUndefined();
  // Этап без поручения копию не снимает: прогон был, а директива не выполнена.
  expect(state.directive).toBeUndefined();
});

test("only the stage told to do so marks the directive done", async () => {
  const talk = await callWith({ ...workflowTree }, "finish_directive", {
    ...directive,
    stage: "Обсудить",
  });
  const after = JSON.parse(
    talk.writes["/map/_directives.state/2026-09-20-0100-проба.state.json"] ?? "{}",
  );
  expect(after.status).toBeUndefined();
  expect(after.run.finishedAt).toBeDefined();

  const done = await callWith({ ...workflowTree }, "finish_directive", {
    ...directive,
    stage: "Выполнить",
  });
  const state = JSON.parse(
    done.writes["/map/_directives.state/2026-09-20-0100-проба.state.json"] ?? "{}",
  );
  expect(state.status).toBe("done");
  // Копия побайтная: по ней выполненная директива отличается от изменившейся.
  expect(state.directive).toBe("текст директивы");
});

test("an unknown stage names the ones the object has", async () => {
  await expect(
    callWith({ ...workflowTree }, "run_directive", { ...directive, stage: "нет такого" }),
  ).rejects.toThrow(/Обсудить/);
});

test("read_object shows the workflow acting on the object", async () => {
  const { result } = await callWith({ ...workflowTree }, "read_object", { metrics: [] });

  expect(result.workflow).toEqual([
    { name: "Обсудить", order: 10, path: "/map/_directives.workflow/обсудить.md" },
    {
      name: "Выполнить",
      order: 20,
      marksDone: true,
      path: "/map/_directives.workflow/выполнить.md",
    },
  ]);
});

test("the workflow and the layout come only with the top object", async () => {
  const { result } = await callWith(
    { ...workflowTree, "/map/packages/_index.json": JSON.stringify({ name: "Пакеты" }) },
    "read_object",
    { depth: 1, metrics: [] },
  );

  // У верхнего объекта они есть...
  expect(result.workflow).toHaveLength(2);
  expect(result.layout).toBeDefined();

  // ...а раскрытому ребёнку те же самые не повторяются: спросят его отдельно — придут.
  const child = (result.children as Record<string, unknown>[])[0];
  expect(child?.address).toBe("mapward://packages");
  expect(child?.workflow).toBeUndefined();
  expect(child?.layout).toBeUndefined();
});

test("a stage can be read without being run", async () => {
  const { result, writes } = await callWith({ ...workflowTree }, "read_index", {
    address: "mapward://",
    stage: "выполнить",
  });

  // Имя ищется как при запуске — регистр не важен, файл берётся из модели объекта.
  expect(result.name).toBe("Выполнить");
  expect(result.marksDone).toBe(true);
  // Тело без frontmatter — ровно то, что уезжает в промпт прогона.
  expect(String(result.text).trim()).toBe("сделай");
  // Чтение — это не прогон: состояние не тронуто, отметки о запуске нет.
  expect(Object.keys(writes)).toHaveLength(0);
});

test("a stage with no file of its own still has a text", async () => {
  const { result } = await callWith(
    { "/map/_index.json": JSON.stringify({ name: "Карта" }) },
    "read_index",
    { address: "mapward://", stage: "Обсудить" },
  );

  // У дефолтного этапа файла нет вовсе: с диска его не прочитать никак.
  expect(result.builtin).toBe(true);
  expect(result.path).toBeUndefined();
  expect(String(result.text)).toContain("что о ней думаешь");
});

test("an unknown stage names the ones the object has, on reading too", async () => {
  await expect(
    callWith({ ...workflowTree }, "read_index", { address: "mapward://", stage: "нет такого" }),
  ).rejects.toThrow(/Обсудить/);
});

test("a long directive can be read by its tail", async () => {
  const lines = Array.from({ length: 40 }, (_, at) => `строка ${String(at + 1)}`).join("\n");
  const disk = { ...workflowTree, "/map/_directives/2026-09-20-0100-проба.md": lines };

  const { result } = await callWith(disk, "read_index", {
    address: "mapward://",
    file: "2026-09-20-0100-проба.md",
    tail: 3,
  });

  expect(result.lines).toBe(40);
  expect(result.tail).toBe(3);
  expect(result.text).toBe("строка 38\nстрока 39\nстрока 40");
});

test("a file shorter than the tail comes whole, and says so", async () => {
  const { result } = await callWith({ ...workflowTree }, "read_index", {
    address: "mapward://",
    file: "2026-09-20-0100-проба.md",
    tail: 40,
  });

  expect(result.text).toBe("текст директивы");
  expect(result.lines).toBe(1);
  // Резать было нечего — и поля, которое говорит «отрезано», в ответе нет.
  expect(result.tail).toBeUndefined();
});

test("the map counts how many rounds each stage has run", async () => {
  const disk = { ...workflowTree };
  await callWith(disk, "run_directive", { ...directive, stage: "Обсудить" });
  await callWith(disk, "run_directive", { ...directive, stage: "Обсудить" });
  await callWith(disk, "run_directive", { ...directive, stage: "Выполнить" });

  const { result } = await callWith(disk, "read_object", { metrics: [] });
  const files = (result.directives as { files: { runs?: Record<string, number> }[] }).files;

  // Третий Брейншторм и первый читаются по-разному — счётчик про это и говорит.
  expect(files[0]?.runs).toEqual({ Обсудить: 2, Выполнить: 1 });
});

test("a metric that never ran says so, instead of looking empty", async () => {
  const quiet = await call("read_object", { address: "mapward://packages/core" });
  const value = (quiet.metrics as { key: string; value: { collected: boolean } }[]).find(
    (metric) => metric.key === "tests",
  )?.value;

  // Дорогая метрика без прогона: `{ busy: false }` выглядело бы собранной пустотой.
  expect(value?.collected).toBe(false);

  const filled = await call("read_object", {
    address: "mapward://packages/core",
    metrics: ["version"],
    refresh: "on-display",
  });
  const version = (filled.metrics as { value: { collected: boolean } }[])[0]?.value;
  expect(version?.collected).toBe(true);
});
