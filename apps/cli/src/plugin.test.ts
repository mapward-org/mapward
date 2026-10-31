import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createMapServer, serveMcp } from "@mapward/abstract-server";
import { findMetricOwner } from "@mapward/core";
import { createPorts } from "./ports.ts";

/**
 * Плагин целиком: TypeScript собирает настоящий esbuild в WebAssembly, процесс — настоящий node,
 * разговор — строками протокола через stdio. Живёт в cli: процессы и `.wasm` даёт node.
 */

let root = "";
const slash = (path: string) => path.replaceAll("\\", "/");

const files: Record<string, string> = {
  "map/_index.json": JSON.stringify({ name: "Корень", props: { title: "карта" } }),
  "map/core/_index.json": JSON.stringify({ name: "core", props: { codePath: "packages/core" } }),
  "map/_plugins/hello/index.ts": [
    'import { definePlugin } from "@mapward/plugin";',
    'import { basename } from "node:path";',
    'import { defer, map, Observable, of } from "rxjs";',
    'import { take } from "rxjs/operators";',
    'import Type from "typebox";',
    'import { Value } from "typebox/value";',
    'import { greet } from "./greet.ts";',
    "",
    "export default definePlugin({",
    '  description: "приветствия",',
    "  methods: {",
    "    hello: {",
    '      description: "поздороваться",',
    "      params: Type.Object({ name: Type.String() }),",
    "      run: (args) => of(greet(args.name)),",
    "    },",
    "    where: { run: (_args: unknown, ctx) => of(basename(ctx.pluginDir) + ' ' + process.cwd().replaceAll('\\\\', '/').endsWith('_plugins/hello')) },",
    "    codePath: {",
    "      run: (args: { address: string }, ctx) =>",
    "        ctx.object(args.address).pipe(map((object) => object?.props.codePath), take(1)),",
    "    },",
    // Потоки ctx и rxjs плагина — одна копия: `instanceof` сходится; typebox — тот же, что у рантайма.
    "    same: {",
    "      run: (_args: unknown, ctx) =>",
    "        of([ctx.object('mapward://') instanceof Observable, Value.Check(Type.String(), 'x')]),",
    "    },",
    "    count: {",
    '      kind: "mutation",',
    "      run: () =>",
    "        defer(() => {",
    "          console.log('это в stderr, а не в протокол');",
    "          return of(1, 2);",
    "        }),",
    "    },",
    "  },",
    "});",
  ].join("\n"),
  "map/_plugins/hello/greet.ts":
    "export const greet = (name: string): string => `привет, ${name}`;",
  // Метрика-компонент: вид — `.tsx`, агенту — запрос к плагину с параметрами из props.
  "map/core/_metrics/greeting/config.json": JSON.stringify({
    label: "Приветствие",
    component: "./view.tsx",
    params: { name: "${{ mapward://~#props.codePath }}" },
    agent: {
      plugin: "../../../_plugins/hello",
      method: "hello",
      params: { name: "${{ mapward://~#props.codePath }}" },
    },
  }),
  "map/core/_metrics/greeting/view.tsx": "export default function View() { return null; }",
  // Та же метрика у объекта без `codePath`, как у прототипа: подстановка ждёт наследника.
  "map/draft/_index.json": JSON.stringify({ name: "draft" }),
  "map/draft/_metrics/greeting/config.json": JSON.stringify({
    component: "../../../core/_metrics/greeting/view.tsx",
    agent: {
      plugin: "../../../_plugins/hello",
      method: "hello",
      params: { name: "${{ mapward://~#props.codePath }}" },
    },
  }),
  "map/core/_metrics/silent/config.json": JSON.stringify({ component: "./view.tsx" }),
  "map/core/_metrics/silent/view.tsx": "export default function View() { return null; }",
  "map/_plugins/broken/index.ts": 'import { nope } from "missing-package";\nexport default nope;',
};

type Stream = {
  subscribe(observer: {
    next: (value: unknown) => void;
    error: (error: unknown) => void;
    complete: () => void;
  }): { unsubscribe(): void };
};

/** Весь поток до конца — rxjs у cli нет, а поток он отдаёт с его формой. */
const collect = (stream: Stream) =>
  new Promise<unknown[]>((resolve, reject) => {
    const values: unknown[] = [];
    stream.subscribe({
      next: (value) => values.push(value),
      error: reject,
      complete: () => resolve(values),
    });
  });
const first = async (stream: Stream) => (await collect(stream))[0];

const ref = () => ({ mapPath: `${root}/map`, basePath: root, name: "Корень" });

beforeAll(async () => {
  root = slash(await mkdtemp(join(tmpdir(), "mapward-plugin-")));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, text, "utf8");
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Доверие спрашивают у человека; в тесте отвечает сам тест — и `~/.mapward` не трогается. */
/** Зависимости встроенного плагина — подставной командой: тест без сети и без npm. */
const installedIn: string[] = [];

function server(trusted: boolean, granted: string[] = []) {
  return createMapServer({
    ...createPorts(),
    packages: {
      install: async (dir) => {
        installedIn.push(slash(dir));
      },
    },
    trust: {
      allow: async ({ plugin }) => trusted || granted.includes(plugin),
      grant: async ({ plugin }) => {
        granted.push(plugin);
      },
    },
  });
}

test("метод плагина: сборка, процесс, ответ; рабочая папка — папка плагина", async () => {
  const map = server(true);
  const plugin = `${root}/map/_plugins/hello`;
  try {
    expect(
      await first(map.callPlugin({ ...ref(), plugin, method: "hello", args: { name: "мир" } })),
    ).toBe("привет, мир");
    expect(await first(map.callPlugin({ ...ref(), plugin, method: "where" }))).toBe("hello true");
    expect(
      await first(
        map.callPlugin({
          ...ref(),
          plugin,
          method: "codePath",
          args: { address: "mapward://core" },
        }),
      ),
    ).toBe("packages/core");
    // `console.log` плагина ушёл в лог, а не сломал разговор.
    expect(await first(map.callPlugin({ ...ref(), plugin, method: "same" }))).toEqual([true, true]);
    expect(await collect(map.callPlugin({ ...ref(), plugin, method: "count" }))).toEqual([1, 2]);
    expect(map.pluginLog({ ...ref(), plugin })).toContain("это в stderr, а не в протокол");

    expect(await map.describePlugin({ ...ref(), plugin })).toEqual({
      description: "приветствия",
      activation: {},
      methods: {
        hello: {
          kind: "query",
          description: "поздороваться",
          params: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
        where: { kind: "query" },
        codePath: { kind: "query" },
        same: { kind: "query" },
        count: { kind: "mutation" },
      },
    });
    // Схема typebox проверяет аргументы до `run`: отказ называет поле.
    await expect(
      first(map.callPlugin({ ...ref(), plugin, method: "hello", args: { name: 1 } })),
    ).rejects.toThrow(/не по схеме: \/name/);

    // rxjs и typebox в сборке плагина — одна копия, та, что едет с `@mapward/plugin`: своей
    // сборка не вкладывает, да и `node_modules` у плагина в карте нет.
    const built = join(root, "map/.mapward/plugins");
    const script = (await readdir(built)).find((name) => name.includes("hello"));
    const code = await readFile(join(built, script ?? ""), "utf8");
    // esbuild переименовывает класс (`Observable2`), но копия одна.
    expect(code.match(/function Observable\d*\(subscribe\)/g)).toHaveLength(1);
  } finally {
    await map.stopPlugins();
  }
}, 30_000);

test("несобранный и недоверенный плагин — отказ с причиной", async () => {
  const trusted = server(true);
  const untrusted = server(false);
  try {
    await expect(
      first(trusted.callPlugin({ ...ref(), plugin: `${root}/map/_plugins/broken`, method: "x" })),
    ).rejects.toThrow(/missing-package/);
    await expect(
      first(
        untrusted.callPlugin({ ...ref(), plugin: `${root}/map/_plugins/hello`, method: "hello" }),
      ),
    ).rejects.toThrow(/не доверен/);
  } finally {
    await trusted.stopPlugins();
    await untrusted.stopPlugins();
  }
}, 30_000);

/** Инструмент MCP по-настоящему: ответ разбирается из текста, как его читает агент. */
async function mcp(
  map: ReturnType<typeof server>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let handler: ((message: unknown) => void) | undefined;
  const replies: { result?: { content: { text: string }[] }; error?: { message: string } }[] = [];
  serveMcp(map, [ref()], {
    onMessage: (next) => {
      handler = next;
      return () => undefined;
    },
    send: (message) => replies.push(message as (typeof replies)[number]),
  });
  handler?.({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  for (let tick = 0; tick < 300 && replies.length === 0; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const reply = replies[0];
  if (reply?.error) throw new Error(reply.error.message);
  return JSON.parse(reply?.result?.content[0]?.text ?? "null") as Record<string, unknown>;
}

test("агент видит метрику-компонент её запросом и зовёт плагин сам", async () => {
  const map = server(true);
  try {
    const listed = await mcp(map, "read_object", { address: "mapward://core" });
    expect(listed.metricsHint).toBeDefined();

    const object = await mcp(map, "read_object", {
      address: "mapward://core",
      metrics: ["greeting", "silent"],
    });
    const shown = object.metrics as {
      key: string;
      agent?: { method: string };
      value?: Record<string, unknown>;
    }[];
    const greeting = shown.find((metric) => metric.key === "greeting");
    const silent = shown.find((metric) => metric.key === "silent");
    expect(greeting?.agent?.method).toBe("hello");
    expect(greeting?.value).toEqual({ collected: true, ok: true, data: "привет, packages/core" });
    expect(silent?.value?.collected).toBe(false);
    expect(String(silent?.value?.hint)).toMatch(/describe_plugin/);

    const described = await mcp(map, "describe_plugin", { plugin: "_plugins/hello" });
    expect(Object.keys(described.methods as object)).toEqual([
      "hello",
      "where",
      "codePath",
      "same",
      "count",
    ]);

    expect(
      await mcp(map, "call_plugin", {
        plugin: "_plugins/hello",
        method: "hello",
        args: { name: "агент" },
      }),
    ).toEqual({ value: "привет, агент" });
    expect(
      await mcp(map, "call_plugin", {
        plugin: "_plugins/hello",
        method: "count",
        wait: "complete",
      }),
    ).toEqual({ values: [1, 2] });
  } finally {
    await map.stopPlugins();
  }
}, 30_000);

/**
 * `mapward plugin check` и `check_plugin` — одна проверка: сборка, процесс и рукопожатие,
 * самоописание и метрики, которые ссылаются на плагин. Битый плагин падает на сборке с файлом.
 */
test("проверка плагина: шаги до метрик, битый — на сборке с местом ошибки", async () => {
  const map = server(true);
  try {
    const good = await mcp(map, "check_plugin", { plugin: "_plugins/hello" });
    const steps = good.steps as { title: string; status: string; lines: string[] }[];
    expect(good.ok).toBe(true);
    expect(steps.map((step) => [step.title, step.status])).toEqual([
      ["сборка", "ok"],
      ["процесс и рукопожатие", "ok"],
      ["самоописание", "ok"],
      ["метрика mapward://core/_metrics/greeting", "ok"],
      ["метрика mapward://draft/_metrics/greeting", "skip"],
    ]);
    expect(steps[2]?.lines).toContain("hello (query): поздороваться");
    expect(steps[3]?.lines[0]).toMatch(/^компонент собран: \d+ байт$/);
    expect(steps[3]?.lines[1]).toBe('запрос для агента hello ответил: "привет, packages/core"');
    // Неразрешённую подстановку пробно не зовём: красное было бы ложным.
    expect(steps[4]?.lines[1]).toBe(
      "запрос для агента не зовём — подстановки не разрешились: mapward://~#props.codePath",
    );

    const broken = await map.checkPlugin({ ...ref(), plugin: `${root}/map/_plugins/broken` }, 5000);
    expect(broken.ok).toBe(false);
    expect(broken.steps.map((step) => step.title)).toEqual(["сборка"]);
    expect(broken.steps[0]?.lines.join("\n")).toMatch(/index\.ts:1:\d+: .*missing-package/);
  } finally {
    await map.stopPlugins();
  }
}, 60_000);

test("встроенный files: копия в карту, доверие без вопроса, метод отвечает; копию не перезаписать", async () => {
  const granted: string[] = [];
  const map = server(false, granted);
  const plugin = `${root}/map/_plugins/files`;
  try {
    const installed = await map.installPlugin({ ...ref(), name: "files" });
    expect(installed).toMatchObject({ ok: true, plugin });
    expect(granted).toEqual([plugin]);
    expect(await readFile(join(plugin, "index.ts"), "utf8")).toMatch(/definePlugin/);

    // Сводка по папке `core` карты: `_index.json` и две метрики по конфигу и виду.
    const summary = (await first(
      map.callPlugin({ ...ref(), plugin, method: "summary", args: { path: `${root}/map/core` } }),
    )) as { files: number; dirs: number };
    expect(summary).toMatchObject({ files: 5, dirs: 3 });

    // Существующую копию не трогаем: правка человека переживает повторную установку.
    await writeFile(join(plugin, "index.ts"), "// правка", "utf8");
    expect(await map.installPlugin({ ...ref(), name: "files" })).toMatchObject({ ok: false });
    expect(await readFile(join(plugin, "index.ts"), "utf8")).toBe("// правка");
  } finally {
    await map.stopPlugins();
  }
}, 30_000);

test("встроенный по своему месту доставляется сам; неизвестный — перечень встроенных агенту", async () => {
  const granted: string[] = [];
  const map = server(false, granted);
  try {
    expect(
      await first(
        map.callPlugin({
          ...ref(),
          plugin: `${root}/map/_plugins/navigation`,
          method: "open",
          args: { link: "mapward://core" },
        }),
      ),
    ).toEqual({ kind: "object", address: "mapward://core" });
    expect(granted).toEqual([`${root}/map/_plugins/navigation`]);

    await expect(mcp(map, "describe_plugin", { plugin: "_plugins/nope" })).rejects.toThrow(
      /Встроенные плагины: .*files.*navigation.*add_plugin/,
    );
    expect(await mcp(map, "add_plugin", { name: "navigation", path: "tools/nav" })).toMatchObject({
      ok: true,
      plugin: `${root}/map/tools/nav`,
    });
    await expect(mcp(map, "add_plugin", { name: "navigation", path: "tools/nav" })).rejects.toThrow(
      /уже есть/,
    );
  } finally {
    await map.stopPlugins();
  }
}, 30_000);

test("встроенный objects-map: вьюха по карте и правка, которая создаёт объект на диске", async () => {
  const granted: string[] = [];
  const map = server(false, granted);
  const plugin = `${root}/map/_plugins/objects-map`;
  const view = "mapward://_metrics/canvas";
  try {
    expect(await map.installPlugin({ ...ref(), name: "objects-map" })).toMatchObject({
      ok: true,
      dependencies: ["@xyflow/react"],
    });
    // Холст — компоненты плагина: они едут с ним, а их зависимости ставятся в его папку.
    expect(await readFile(join(plugin, "view.tsx"), "utf8")).toMatch(/<Canvas/);
    expect(await readFile(join(plugin, "canvas/flow.tsx"), "utf8")).toMatch(/@xyflow\/react/);
    expect(await readFile(join(plugin, ".gitignore"), "utf8")).toContain("node_modules");
    expect(installedIn).toContain(plugin);
    // Вьюха — метрика-компонент этого плагина: что показать, сказано в её `params`.
    await mkdir(join(root, "map/_metrics/canvas"), { recursive: true });
    await writeFile(
      join(root, "map/_metrics/canvas/config.json"),
      JSON.stringify({
        label: "Холст",
        component: "../../_plugins/objects-map/view.tsx",
        params: { show: ["core", "склад"], placeObjects: "mapward://" },
        agent: { plugin: "../../_plugins/objects-map", method: "view", params: { view } },
      }),
      "utf8",
    );
    await map.reloadMap(ref());

    // Вьюха — поток, который не кончается: берётся первое значение.
    const shown = (await map.pluginFirst(
      { ...ref(), plugin, method: "view", args: { view } },
      20_000,
    )) as { view: string; nodes: { id: string; label: string }[]; canPlaceObjects: boolean };
    expect(shown.view).toBe(view);
    expect(shown.nodes.map((node) => node.label)).toEqual(["core"]);
    expect(shown.canPlaceObjects).toBe(true);

    const done = (await first(
      map.callPlugin({
        ...ref(),
        plugin,
        method: "edit",
        args: { view, ops: [{ op: "create-object", name: "Склад", position: { x: 10, y: 20 } }] },
      }),
    )) as { ok: boolean; id?: string; error?: string };
    expect(done).toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(join(root, "map/склад/_index.json"), "utf8"))).toEqual({
      name: "Склад",
    });
    const state = JSON.parse(
      await readFile(join(root, "map/_metrics/canvas/map-state.json"), "utf8"),
    );
    expect(state.positions["mapward://склад"]).toEqual({ x: 10, y: 20 });
  } finally {
    await map.stopPlugins();
  }
}, 30_000);

/** Карта этого репозитория: переведённые метрики отвечают агенту своим запросом. */
const repo = slash(join(fileURLToPath(import.meta.url), "../../../.."));
const worktree = () => ({ mapPath: `${repo}/ru/map`, basePath: repo, name: "mapward" });

test("карта worktree: метрики нового вида отвечают своим запросом для агента", async () => {
  const map = server(true);
  const here = worktree();
  const plugins = `${repo}/ru/map/_plugins`;
  // Метрики по всей карте репозитория — тесту нужна она вся.
  const tree = (await map.readObject({ ...here, address: "mapward://", depth: Infinity }))!;
  const metricOf = (address: string) => {
    const metric = findMetricOwner(tree, address)?.metric;
    if (!metric?.config.agent) throw new Error(`у ${address} нет запроса для агента`);
    return metric;
  };
  /** То, что видит агент: первое значение запроса метрики. */
  const asked = async (address: string) => {
    const request = metricOf(address).config.agent!;
    return map.pluginFirst(
      { ...here, plugin: request.plugin, method: request.method, args: request.params },
      60_000,
    );
  };
  try {
    // Вид — компонент встроенного `views`, запрос — тот же источник, что у вида, после подстановок.
    const version = metricOf("mapward://packages/core/_metrics/version");
    expect(version.config.component).toBe(`${plugins}/views/text.tsx`);
    expect(version.config.agent).toEqual((version.config.params as { source: unknown }).source);
    expect(version.config.agent).toMatchObject({ plugin: `${plugins}/shell`, method: "json" });

    // script → shell.json: версия пакета из его package.json.
    const text = (await asked("mapward://packages/core/_metrics/version")) as { text: string };
    expect(text.text).toMatch(/^\d+\.\d+\.\d+/);

    // read-dir + git-status → files.tree с git: дерево доков архитектуры.
    const docs = (await asked("mapward://_metrics/architecture-docs")) as {
      children: { label: string }[];
    };
    expect(docs.children.map((node) => node.label)).toContain("packages.md");

    // Трансформ script → shell.json с from: дерево файлов уходит скрипту, меню строк — от него.
    const listing = (await asked("mapward://packages/core/_metrics/files")) as {
      children: { label: string; actions?: { run: string }[] }[];
    };
    const src = listing.children.find((node) => node.label === "src");
    expect(src?.actions?.map((action) => action.run)).toContain("file-new");

    // Требования своего объекта: дерево с текстом → статусы скриптом, объект — окружением.
    const own = (await asked("mapward://packages/core/_metrics/requirements")) as {
      children: unknown[];
    };
    expect(Array.isArray(own.children)).toBe(true);

    // prompt → agent.ask: сохранённый ответ из файла рядом с объектом, без нового вопроса.
    const drift = metricOf("mapward://packages/core/_metrics/code-drift");
    expect(drift.config.agent).toMatchObject({
      plugin: `${plugins}/agent`,
      method: "ask",
      params: { cache: `${here.mapPath}/packages/core/_metrics/code-drift/answer.json` },
    });
    expect(await asked("mapward://packages/core/_metrics/code-drift")).toMatchObject({
      asked: true,
      updatedAt: expect.any(String) as unknown,
    });

    // Свой компонент прежнего вида — теперь метрика-компонент: данные берёт у shell сам.
    const decisions = (await asked("mapward://_metrics/demo-decisions")) as {
      decisions: { number: string }[];
    };
    expect(decisions.decisions.length).toBeGreaterThan(0);

    // Вид собирается тем же сборщиком, что любой компонент метрики.
    const build = await new Promise<{ errors?: string[]; code?: string }>((resolve, reject) => {
      const subscription = map
        .watchComponent({ ...here, metric: "mapward://packages/core/_metrics/version" })
        .subscribe({
          next: (value) => {
            resolve(value as { errors?: string[]; code?: string });
            queueMicrotask(() => subscription.unsubscribe());
          },
          error: reject,
        });
    });
    expect(build.errors).toBeUndefined();
    expect(build.code).toContain('require("@mapward/component")');
  } finally {
    await map.stopPlugins();
  }
}, 120_000);
