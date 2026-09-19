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
  "/map/packages/_index.json": JSON.stringify({ name: "Пакеты" }),
  "/map/packages/core/_index.json": JSON.stringify({ name: "core" }),
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
  expect(object.children).toEqual([{ address: "mapward://packages", name: "Пакеты" }]);
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
