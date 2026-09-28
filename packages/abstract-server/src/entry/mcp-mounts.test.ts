import { expect, test } from "vitest";
import type { ResolvedMap } from "@mapward/core";
import type { FilesPort, ServerPorts } from "../ports/index.ts";
import { createMapServer } from "./server.ts";
import { serveMcp, type McpTransport } from "./mcp.ts";

/**
 * Подключённая карта глазами агента: адрес с именем подключения ведёт в неё, а правка вьюхи
 * родителя кладёт её объекты ссылками. Своя фикстура — чужие тесты перечисляют детей корня.
 */
function fakeFiles(tree: Record<string, string>): FilesPort {
  return {
    read: (path) => Promise.resolve(tree[path]),
    list: (path) => {
      const prefix = `${path}/`;
      const names = new Map<string, boolean>();
      for (const candidate of Object.keys(tree)) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) names.set(rest, false);
        else names.set(rest.slice(0, cut), true);
      }
      return Promise.resolve([...names].map(([name, isDirectory]) => ({ name, isDirectory })));
    },
    write: (path, text) => {
      tree[path] = text;
      return Promise.resolve();
    },
    remove: (path) => {
      delete tree[path];
      return Promise.resolve();
    },
    watch: () => () => undefined,
  };
}

const tree = (): Record<string, string> => ({
  "/space/map/_index.json": JSON.stringify({ name: "Пространство" }),
  "/space/map/relations/_index.json": JSON.stringify({ name: "Связи" }),
  "/space/map/_metrics/canvas/config.json": JSON.stringify({
    collectors: [{ kind: "objects-map", placeRelations: "mapward://relations" }],
    display: { kind: "map" },
  }),
  "/space/map/summary/_index.json": JSON.stringify({
    name: "Сводка",
    props: { team: "${{ mapward://leafer:/arch#props.team }}" },
  }),
  "/space/leafer/map/_index.json": JSON.stringify({ name: "Leafer" }),
  "/space/leafer/map/arch/_index.json": JSON.stringify({
    name: "Архитектура",
    props: { team: "leafer", root: "${{ mapward://@ }}" },
  }),
});

const space: ResolvedMap = {
  name: "Пространство",
  mapPath: "/space/map",
  basePath: "/space",
  configPath: "/space/mapward.json",
  mounts: {
    leafer: { mapPath: "/space/leafer/map", configPath: "/space/leafer/mapward.json", index: 0 },
    ed: { error: "Нет mapward.json по пути /space/ed/mapward.json" },
  },
};
const leafer: ResolvedMap = {
  name: "Leafer",
  mapPath: "/space/leafer/map",
  basePath: "/space/leafer",
  configPath: "/space/leafer/mapward.json",
};

function serve(files: Record<string, string>) {
  const ports: ServerPorts = {
    files: fakeFiles(files),
    shell: {
      run: () => Promise.resolve({ stdout: "{}", stderr: "" }),
      pipe: () => Promise.resolve({ stdout: "{}", stderr: "" }),
    },
    agent: { run: () => Promise.resolve({ stdout: "{}", stderr: "" }) },
    clock: { now: () => new Date().toISOString() },
    timers: { every: () => () => undefined, after: () => () => undefined },
    env: { vars: () => ({}) },
    capabilities: {
      terminals: false,
      openFile: false,
      ask: false,
      virtualDocs: false,
      tabs: false,
    },
  };
  const server = createMapServer(ports);
  server.setMaps([space, leafer]);
  let handler: ((message: unknown) => void) | undefined;
  const replies: Record<string, unknown>[] = [];
  const transport: McpTransport = {
    onMessage: (next) => {
      handler = next;
      return () => undefined;
    },
    send: (message) => replies.push(message as Record<string, unknown>),
  };
  serveMcp(server, [space], transport);

  return async (name: string, args: Record<string, unknown>) => {
    replies.length = 0;
    handler?.({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    for (let tick = 0; tick < 2000 && replies.length === 0; tick++) await Promise.resolve();
    const reply = replies[0];
    if (!reply) throw new Error("ответа не было");
    if (reply.error) throw new Error(String((reply.error as { message?: string }).message));
    const content = (reply.result as { content: { text: string }[] }).content;
    return JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>;
  };
}

test("an address with a mount name reads the object of the mounted map and says whose it is", async () => {
  const call = serve(tree());
  const object = await call("read_object", {
    address: "mapward://leafer:/arch",
    metrics: [],
    fields: ["address", "props", "map", "mount"],
  });
  expect(object).toEqual({
    address: "mapward://arch",
    // Поля объекта проекта посчитаны от его карты: `@` — корень проекта, а не пространства.
    props: { team: "leafer", root: "/space/leafer" },
    map: "Leafer",
    mount: "leafer",
  });
});

test("the parent reads a field of a mounted map's object through a substitution", async () => {
  const call = serve(tree());
  const summary = await call("read_object", {
    address: "mapward://summary",
    metrics: [],
    fields: ["props"],
  });
  expect(summary.props).toEqual({ team: "leafer" });
});

test("a missing mount is refused with the reason, not answered with the parent", async () => {
  const call = serve(tree());
  await expect(call("read_object", { address: "mapward://ed:/core" })).rejects.toThrow(
    "Нет mapward.json по пути /space/ed/mapward.json",
  );
});

test("list_maps shows the mounts of each map by name", async () => {
  const call = serve(tree());
  const listed = (await call("list_maps", {})) as unknown as Record<string, unknown>[];
  expect(listed[0]?.mounts).toEqual({
    leafer: { mapPath: "/space/leafer/map" },
    ed: { error: "Нет mapward.json по пути /space/ed/mapward.json" },
  });
});

test("edit_map puts an object of the mounted map on the parent's view and draws a relation to it", async () => {
  const files = tree();
  const call = serve(files);
  await call("edit_map", {
    ops: [
      { op: "add-ref", view: "mapward://_metrics/canvas", object: "mapward://leafer:/arch" },
      {
        op: "create-relation",
        view: "mapward://_metrics/canvas",
        from: "mapward://summary",
        to: "mapward://leafer:/arch",
      },
    ],
  });
  expect(JSON.parse(files["/space/map/_metrics/canvas/map-state.json"] ?? "{}")).toMatchObject({
    refs: ["mapward://leafer:/arch"],
  });
  expect(JSON.parse(files["/space/map/relations/summary-to-arch/_index.json"] ?? "{}")).toEqual({
    name: "связь",
    props: { from: "mapward://summary", to: "mapward://leafer:/arch" },
  });
  await expect(
    call("edit_map", { ops: [{ op: "delete-object", object: "mapward://leafer:/arch" }] }),
  ).rejects.toThrow("в ней самой");

  // Вьюха родителя рисует объект проекта узлом, помеченным его картой, и стрелку к нему.
  const canvas = (await call("run_metric", { address: "mapward://_metrics/canvas" })) as {
    data: Record<string, unknown[]>;
  };
  expect(canvas.data.nodes).toEqual([
    expect.objectContaining({ id: "mapward://leafer:/arch", map: "leafer", label: "Архитектура" }),
  ]);
});
