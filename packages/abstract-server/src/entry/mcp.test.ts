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
    watch: () => () => undefined,
  };
}

const tree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/prototypes/_index.json": JSON.stringify({ name: "Прототипы" }),
  "/map/prototypes/package/_index.json": JSON.stringify({ name: "Пакет" }),
  "/map/prototypes/package/_actions/publish-version.md": "как выпускать версию",
  "/map/prototypes/package/_directives/create-package.md": "как заводить пакет",
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
  capabilities: { terminals: false, openFile: false, ask: false },
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
  expect(object.directives).toEqual([
    {
      name: "create-package.md",
      path: "/map/prototypes/package/_directives/create-package.md",
      owner: "mapward://prototypes/package",
      status: "new",
    },
  ]);

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

  expect(Object.keys(slim)).toEqual(["address", "metrics"]);
  expect(slim.metrics).toEqual([
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
    fields: ["children.address", "children.metrics.key"],
  });

  expect(deep).toEqual({
    children: [
      {
        address: "mapward://packages/core",
        metrics: [{ key: "version" }, { key: "tests" }],
      },
    ],
  });
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
