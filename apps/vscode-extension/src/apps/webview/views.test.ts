import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { NEVER } from "rxjs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BuildComponent } from "@mapward/abstract-server";
import type { AppBridge, BridgeClient, ComponentBuild, MapObject } from "@mapward/core";
import { ViewStates } from "../../../../../packages/abstract-react-client/src/services/state/adapters/view-state.ts";
import { ProvideViewStates } from "../../../../../packages/abstract-react-client/src/services/state/ports.tsx";
import { ComponentDisplay } from "../../../../../packages/abstract-react-client/src/features/metrics/compose/component-display.tsx";
import {
  ProvideMetrics,
  ProvideNavigation,
  ProvidePluginKit,
  type MetricsPort,
  type PluginKit,
} from "../../../../../packages/abstract-react-client/src/features/metrics/ports.tsx";
import { ComponentBuilds } from "../../../../../packages/abstract-react-client/src/features/metrics/adapters/component-builds.ts";
import { CallMemory } from "../../../../../packages/abstract-react-client/src/features/metrics/model/call-memory.ts";

/**
 * Готовые виды встроенного плагина `views` и его кирпичи (`bricks/`) — первым кадром. Компонент
 * собирает тот же сборщик, что на карте (esbuild в WebAssembly): кирпичи доходят до него
 * относительным импортом и собираются внутрь, а `@mapward/component` — API окна — подменяет
 * ячейка. Выполняет та же ячейка: значит, проверяется путь, которым вид доходит до экрана. У
 * клиента нет `react-dom`, поэтому это живёт здесь.
 */

const slash = (path: string) => path.replaceAll("\\", "/");
const repo = slash(join(dirname(fileURLToPath(import.meta.url)), "../../../../.."));
const views = `${repo}/packages/plugins/registry/views`;

const require = createRequire(import.meta.url);
const builder = new BuildComponent(
  {
    read: (path) => readFile(path, "utf8").catch(() => undefined),
    list: async (path) =>
      (await readdir(path, { withFileTypes: true }).catch(() => [])).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
  },
  { now: () => "now" },
  {
    wasm: () =>
      readFile(join(dirname(require.resolve("esbuild-wasm/package.json")), "esbuild.wasm")),
  },
);

/** Свои компоненты на кирпичах — как их пишут в карте: кирпичи относительным путём. */
const OWN: Record<string, string[]> = {
  layout: [
    'import type { LayoutProps } from "@mapward/component";',
    `import { ActionButton } from ${JSON.stringify(`${views}/bricks/action-button.tsx`)};`,
    `import { Grid } from ${JSON.stringify(`${views}/bricks/grid.tsx`)};`,
    "export default function Layout({ metrics }: LayoutProps) {",
    "  return (",
    '    <Grid variants={{ "min-width: 0px": { areas: [["code"], ["release"]], style: { gap: "8px" } },',
    '                      "min-width: 600px": { areas: [["code", "release"]] } }}>',
    '      {{ ...metrics, release: <ActionButton action="release" label="Выпустить" /> }}',
    "    </Grid>",
    "  );",
    "}",
  ],
  bricks: [
    `import { Display } from ${JSON.stringify(`${views}/bricks/display.tsx`)};`,
    `import { FileTree } from ${JSON.stringify(`${views}/bricks/file-tree.tsx`)};`,
    `import { List } from ${JSON.stringify(`${views}/bricks/list.tsx`)};`,
    "export default function View() {",
    "  return (",
    "    <div>",
    '      <List items={[{ label: "тест", action: { run: "rerun" }, actions: [{ run: "nope" }] }]} />',
    '      <FileTree id="left" items={[{ label: "src", isDir: true, children: [{ label: "core.ts" }] }]} />',
    '      <Display kind="list" data={{ items: [{ label: "пункт" }, { object: "mapward://core" }] }} />',
    '      <Display kind="list" data={{ items: [] }} empty="пусто тут" />',
    '      <Display kind="status" data={{ nope: 1 }} />',
    "    </div>",
    "  );",
    "}",
  ],
};

const builds = new Map<string, ComponentBuild>();
let scratch = "";

beforeAll(async () => {
  scratch = slash(await mkdtemp(join(tmpdir(), "mapward-views-")));
  for (const [name, lines] of Object.entries(OWN)) {
    // oxlint-disable-next-line no-await-in-loop
    await writeFile(`${scratch}/${name}.tsx`, lines.join("\n"), "utf8");
  }
  const entries: Record<string, string> = Object.fromEntries([
    ...["list", "tree", "link", "status", "text", "markdown"].map((name) => [
      name,
      `${views}/${name}.tsx`,
    ]),
    ...Object.keys(OWN).map((name) => [name, `${scratch}/${name}.tsx`]),
  ]);
  const built = await Promise.all(
    Object.values(entries).map((entry) => builder.run({ entry, basePath: repo })),
  );
  for (const [at, name] of Object.keys(entries).entries()) builds.set(name, built[at]!.build);
}, 60_000);

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

/** Плагины первого кадра: вызов запоминается, поток молчит — подписка случится после кадра. */
function kit(asked: unknown[]): PluginKit {
  return {
    call: (plugin, method, args) => {
      asked.push({ plugin, method, args });
      return NEVER;
    },
    resolve: (path) => path,
  };
}

/** Мост первого кадра: подписки молчат, вызовы не отвечают. */
const bridge = new Proxy({}, { get: () => () => NEVER }) as unknown as BridgeClient<AppBridge>;

const core = {
  address: "mapward://core",
  name: "core",
  path: "/map/core",
  props: {},
  actions: [],
} as unknown as MapObject;

/** Экшоны: `nope` нет, остальные есть, у `release` идёт два прогона. */
const port: MetricsPort = {
  ref: { mapPath: "/map", basePath: "/", name: "Карта" },
  builds: new ComponentBuilds(bridge, { mapPath: "/map", basePath: "/", name: "Карта" }),
  calls: new CallMemory(),
  params: (_object, metric) => metric.config.params ?? {},
  goTo: () => {},
  actions: {
    changed$: NEVER,
    source: () => undefined,
    handle: (_object, ref) => ({
      label: `экшон ${ref.run}`,
      description: undefined,
      missing: ref.run === "nope",
      running: ref.run === "release" ? 2 : 0,
      run: () => {},
    }),
  },
  Card: (props) => createElement("b", null, `[карточка ${props.item.object}]`),
};

function render(
  view: string,
  display: object,
  asked: unknown[] = [],
  states = new ViewStates(bridge),
) {
  return renderToString(
    createElement(ProvideViewStates, {
      states,
      children: createElement(ProvideMetrics, {
        port,
        children: createElement(ProvideNavigation, {
          navigation: { open: () => {}, tabs: false },
          children: createElement(ProvidePluginKit, {
            kit: kit(asked),
            children: createElement(ComponentDisplay, {
              build: builds.get(view),
              display,
              links: { object: core },
            }),
          }),
        }),
      }),
    }),
  );
}

const metric = (
  view: string,
  params: Record<string, unknown>,
  asked: unknown[] = [],
  states?: ViewStates,
) =>
  render(
    view,
    {
      params,
      object: { address: "mapward://core", name: "core", path: "/map/core", props: {} },
      metric: { key: "m", address: "mapward://core/_metrics/m", label: "Метрика" },
    },
    asked,
    states,
  );

test("every view builds with the map's bundler; the bricks are bundled in, the window API is not", () => {
  for (const [name, build] of builds) {
    expect(build.errors, name).toBeUndefined();
    expect(build.code, name).toContain('require("@mapward/component")');
  }
  // Кирпич — код плагина: он в сборке, а не просьбой к странице.
  expect(builds.get("list")?.code).toContain("нет таких");
  // Классы кирпичей попали в css компонента.
  expect(builds.get("tree")?.css).toContain("rotate-90");
});

test("static data is drawn on the first frame, with the label and no refresh button", () => {
  const list = metric("list", {
    data: { items: [{ label: "Идеи", link: "/repo/ideas.md", status: "success" }] },
  });
  expect(list).toContain("Метрика");
  expect(list).toContain("Идеи");
  expect(list).not.toContain("Обновить");

  // Голый массив — тот же список, пустой — `empty`.
  expect(metric("list", { data: [{ label: "голый" }] })).toContain("голый");
  expect(metric("list", { data: [], empty: "пусто тут" })).toContain("пусто тут");

  const tree = metric("tree", {
    data: { children: [{ label: "readme.md", link: "/repo/readme.md", git: "M" }] },
  });
  expect(tree).toContain("readme.md");
  expect(tree).toContain("codicon-book");

  expect(metric("link", { data: { label: "packages.md", link: "/repo/p.md" } })).toContain(
    "packages.md",
  );
  expect(metric("status", { data: { ok: false, summary: "2 ошибки" } })).toContain("2 ошибки");
  expect(metric("text", { data: "1.2.3" })).toContain("1.2.3");
  expect(metric("markdown", { data: { text: "**жирно**" } })).toContain("<strong>жирно</strong>");
});

test("a source is asked when the view is mounted; until then the frame says it is loading", () => {
  const asked: unknown[] = [];
  const source = { plugin: "/map/_plugins/agent", method: "ask", params: { prompt: "?" } };
  const html = metric("list", { source, refresh: "refresh", empty: "не проверялось" }, asked);

  expect(html).toContain("Метрика");
  expect(html).toContain("загружается…");
  // Кнопка есть: у источника назван изменяющий метод.
  expect(html).toContain("Обновить");
  // Первый кадр ничего не зовёт — подписка живёт, пока вид смонтирован.
  expect(asked).toEqual([]);
});

test("a folded view shows its header only", () => {
  const html = metric("list", { data: { items: [{ label: "спрятано" }] }, collapsed: true });
  expect(html).toContain("Метрика");
  expect(html).not.toContain("спрятано");
});

/**
 * Кирпичи говорят с платформой через `@mapward/component`: экшоны строк — `useAction`, карточки —
 * `ObjectCard`, раскрытие дерева — `useViewState`.
 */
test("bricks: a row action and its menu through useAction, object cards, shapes and empties", () => {
  const html = metric("bricks", {});

  expect(html).toContain("тест");
  expect(html).toContain('title="Запустить: экшон rerun"');
  // Меню строки рисуется по требованию, а «⋯» стоит сразу.
  expect(html).toContain('title="Экшоны строки"');
  // Дерево помнит раскрытое у человека; хранилище первым кадром молчит — папка закрыта.
  expect(html).toContain("src");
  expect(html).not.toContain("core.ts");
  expect(html).toContain("пункт");
  expect(html).toContain("[карточка mapward://core]");
  expect(html).toContain("пусто тут");
  expect(html).toContain("ждём { ok, summary }");
});

/** Раскладка группы на `Grid` из `views` — решения 0029 и 0033 — и кнопка экшона рядом. */
test("a layout puts into Grid only what it names, alongside its own action button", () => {
  const list = [
    { key: "code", label: "code", node: createElement("b", null, "клетка кода") as ReactNode },
    { key: "forgotten", label: "forgotten", node: createElement("b", null, "забытая") },
  ];
  const html = render("layout", {
    metrics: Object.fromEntries(list.map((entry) => [entry.key, entry])),
    list,
    object: { address: "mapward://core", name: "core", path: "/map/core", props: {} },
    group: { key: "всё", label: "Всё" },
  });

  expect(html).toContain("клетка кода");
  expect(html).toContain("Выпустить");
  // Два прогона идут — число рядом с подписью.
  expect(html).toContain("…2");
  // Не названная в сетке метрика не монтируется — значит, и не подписывается.
  expect(html).not.toContain("забытая");
  expect(html).toContain('grid-template-areas: "code release"');
  expect(html).toContain("@container (min-width: 600px)");
  expect(html).toContain("gap: 8px");
});

/** Снимок метрики с `expand: "all"`: дерево раскрыто целиком, свёрнутая метрика — развёрнута. */
test("snapshot expand all opens every folder and unfolds a collapsed view", () => {
  const data = {
    children: [{ label: "src", isDir: true, children: [{ label: "core.ts" }] }],
  };
  expect(metric("tree", { data })).not.toContain("core.ts");

  const snapshot = new ViewStates(bridge, { expand: "all" });
  expect(metric("tree", { data }, [], snapshot)).toContain("core.ts");
  expect(
    metric("list", { data: { items: [{ label: "спрятано" }] }, collapsed: true }, [], snapshot),
  ).toContain("спрятано");
});
