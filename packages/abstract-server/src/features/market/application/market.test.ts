import type { MapEditOp, MapEditResult } from "@mapward/core";
import { expect, test } from "vitest";
import type { FileEntry, FileReader, FileWriter, MarketPort } from "../../../ports/index.ts";
import { InstallPlugin } from "../../plugins/index.ts";
import type { Archive } from "../domain/tar.ts";
import { Market } from "./market.ts";

const REF = { mapPath: "/repo/map", basePath: "/repo", name: "карта" };
const REGISTRY = "https://raw.example/market";

function disk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const port: FileReader & FileWriter = {
    read: async (path) => files.get(path),
    list: async (dir) => {
      const entries = new Map<string, FileEntry>();
      for (const path of files.keys()) {
        if (!path.startsWith(`${dir}/`)) continue;
        const [name = "", ...rest] = path.slice(dir.length + 1).split("/");
        entries.set(name, { name, isDirectory: rest.length > 0 });
      }
      return [...entries.values()];
    },
    write: async (path, text) => {
      files.set(path, text);
    },
    remove: async (path) => {
      files.delete(path);
    },
  };
  return { files, port };
}

/** Сеть: индексы и архивы по адресам; чего нет — 404. */
function network(texts: Record<string, string>, archives: Record<string, Archive>) {
  const asked: string[] = [];
  const port: MarketPort = {
    text: async (url) => {
      asked.push(url);
      return texts[url];
    },
    archive: async (url) => {
      asked.push(url);
      return archives[url];
    },
  };
  return { port, asked };
}

const INDEXES = {
  [`${REGISTRY}/plugins.json`]: JSON.stringify([
    { name: "graph", description: "граф кода", repo: "author/graph", branch: "main" },
  ]),
  [`${REGISTRY}/maps.json`]: JSON.stringify([
    { name: "service", description: "прототип сервиса", repo: "author/service" },
  ]),
};

const GRAPH_V1: Archive = {
  commit: "c1",
  files: { "index.ts": "export default 1;", "README.md": "# граф", ".github/ci.yml": "x" },
  skipped: [],
};
const GRAPH_V2: Archive = {
  commit: "c2",
  files: { "index.ts": "export default 2;", "README.md": "# граф", "lib.ts": "new" },
  skipped: [],
};
const SERVICE: Archive = {
  commit: "s1",
  files: {
    "market.json": JSON.stringify({ plugins: ["graph"] }),
    "service/_index.json": JSON.stringify({ name: "Сервис", props: { self: "mapward://service" } }),
    "service/_metrics/deps/config.json": JSON.stringify({ agent: { plugin: "x" } }),
  },
  skipped: [],
};

const BRANCH = (repo: string) => `https://codeload.github.com/${repo}/tar.gz/refs/heads/main`;
const COMMIT = (repo: string, sha: string) => `https://codeload.github.com/${repo}/tar.gz/${sha}`;

function setup(archives: Record<string, Archive>, initial: Record<string, string> = {}) {
  const { files, port } = disk(initial);
  const granted: string[] = [];
  const installer = new InstallPlugin(
    port,
    {
      allow: async () => false,
      grant: async ({ plugin }) => {
        granted.push(plugin);
      },
    },
    { views: { "index.ts": "встроенный" } },
  );
  const edits: MapEditOp[][] = [];
  const edit = async (_ref: unknown, ops: MapEditOp[]): Promise<MapEditResult> => {
    edits.push(ops);
    for (const op of ops) if (op.op === "writeFile") files.set(op.path, op.text);
    return { ok: true, id: "7", touched: [], created: [], moves: [], copies: [], results: [] };
  };
  const place = async (_ref: unknown, address: string) => {
    const path =
      address === "mapward://" ? "/repo/map" : `/repo/map/${address.slice("mapward://".length)}`;
    if (
      address !== "mapward://" &&
      ![...files.keys()].some((one) => one.startsWith(`${path}/_index.json`))
    ) {
      return undefined;
    }
    const children = new Set<string>();
    for (const one of files.keys()) {
      if (!one.startsWith(`${path}/`)) continue;
      const [child = "", ...rest] = one.slice(path.length + 1).split("/");
      if (rest.length > 0 && !child.startsWith("_")) children.add(child);
    }
    return { path, children: [...children] };
  };
  const net = network(INDEXES, archives);
  const market = new Market(port, net.port, installer, edit, place, () => REGISTRY);
  return { market, files, granted, edits, asked: net.asked };
}

test("поиск идёт по обоим индексам, вид — фильтр", async () => {
  const { market } = setup({});
  expect((await market.search({ query: "граф" })).entries.map((one) => one.name)).toEqual([
    "graph",
  ]);
  expect((await market.search({ kind: "map" })).entries.map((one) => one.name)).toEqual([
    "service",
  ]);
});

test("чтение до установки: дерево без служебного, README и коммит; файл по пути", async () => {
  const { market, files } = setup({ [BRANCH("author/graph")]: GRAPH_V1 });
  const tree = await market.read({ name: "graph" });
  expect(tree).toMatchObject({ commit: "c1", files: ["README.md", "index.ts"], readme: "# граф" });
  expect(await market.read({ name: "graph", path: "index.ts" })).toMatchObject({
    text: "export default 1;",
  });
  await expect(market.read({ name: "graph", path: "nope.ts" })).rejects.toThrow(/нет/);
  expect(files.size).toBe(0);
});

test("плагин ставится в _plugins/<имя> без доверия и с записью «откуда»", async () => {
  const { market, files, granted } = setup({ [BRANCH("author/graph")]: GRAPH_V1 });
  const result = await market.add(REF, { name: "graph" });
  expect(result).toMatchObject({ ok: true, kind: "plugin", commit: "c1", trusted: false });
  expect(granted).toEqual([]);
  expect(files.get("/repo/map/_plugins/graph/index.ts")).toBe("export default 1;");
  expect(files.has("/repo/map/_plugins/graph/.github/ci.yml")).toBe(false);
  expect(JSON.parse(files.get("/repo/map/_plugins/graph/.market.json") ?? "")).toEqual({
    kind: "plugin",
    name: "graph",
    registry: REGISTRY,
    repo: "author/graph",
    branch: "main",
    commit: "c1",
  });
  // Занятое место — отказ, как у встроенных.
  expect(await market.add(REF, { name: "graph" })).toMatchObject({ ok: false });
});

test("доверие — только по слову зовущего", async () => {
  const { market, granted } = setup({ [BRANCH("author/graph")]: GRAPH_V1 });
  await market.add(REF, { name: "graph", trusted: true });
  expect(granted).toEqual(["/repo/map/_plugins/graph"]);
});

test("кусок карты: плагины первыми, объекты под родителем одной пачкой, адреса переписаны", async () => {
  const { market, files, edits } = setup(
    { [BRANCH("author/graph")]: GRAPH_V1, [BRANCH("author/service")]: SERVICE },
    { "/repo/map/apps/_index.json": "{}" },
  );
  const result = await market.add(REF, { name: "service", parent: "mapward://apps" });
  expect(result).toMatchObject({
    ok: true,
    kind: "map",
    id: "7",
    created: ["mapward://apps/service"],
    plugins: [{ name: "graph", plugin: "/repo/map/_plugins/graph" }],
  });
  expect(edits).toHaveLength(1);
  expect(JSON.parse(files.get("/repo/map/apps/service/_index.json") ?? "")).toEqual({
    name: "Сервис",
    props: { self: "mapward://apps/service" },
  });
  expect(JSON.parse(files.get("/repo/map/apps/service/.market.json") ?? "")).toMatchObject({
    kind: "map",
    top: "service",
    parent: "mapward://apps",
    commit: "s1",
  });
  expect(files.has("/repo/map/apps/market.json")).toBe(false);

  // Второй раз: место занято — отказ, плагин уже стоит.
  expect(await market.add(REF, { name: "service", parent: "mapward://apps" })).toMatchObject({
    ok: false,
    error: expect.stringMatching(/уже есть service/),
  });
});

test("кусок карты под несуществующего родителя — отказ до всякой записи", async () => {
  const { market, files } = setup({ [BRANCH("author/service")]: SERVICE });
  expect(await market.add(REF, { name: "service", parent: "mapward://nope" })).toMatchObject({
    ok: false,
  });
  expect(files.size).toBe(0);
});

test("сравнение: что поменял автор с записанного коммита и что поменяли в карте", async () => {
  const archives = { [BRANCH("author/graph")]: GRAPH_V1, [COMMIT("author/graph", "c1")]: GRAPH_V1 };
  const { market, files } = setup(archives);
  await market.add(REF, { name: "graph" });
  files.set("/repo/map/_plugins/graph/README.md", "# граф, поправленный в проекте");
  archives[BRANCH("author/graph")] = GRAPH_V2;
  // Архив ветки помнится минуту — новый экземпляр видит свежую ветку.
  const fresh = setup(archives, Object.fromEntries(files));
  const diff = await fresh.market.diff(REF, { path: "_plugins/graph" });
  expect(diff).toMatchObject({ commit: "c1", latest: "c2" });
  expect(diff.files).toEqual([
    { path: "README.md", local: "changed" },
    { path: "index.ts", author: "changed" },
    { path: "lib.ts", author: "added" },
  ]);
});

test("нет сети у хоста — понятная ошибка", async () => {
  const { port } = disk();
  const installer = new InstallPlugin(port, undefined, {});
  const market = new Market(
    port,
    undefined,
    installer,
    async () => ({ ok: false, error: "" }),
    async () => undefined,
    () => REGISTRY,
  );
  await expect(market.search({})).rejects.toThrow(/нет сети/);
});
