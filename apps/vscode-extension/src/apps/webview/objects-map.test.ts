import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NEVER } from "rxjs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BuildComponent } from "@mapward/abstract-server";
import type { AppBridge, BridgeClient, ComponentBuild } from "@mapward/core";
import type { ObjectsMap } from "../../../../../packages/plugins/registry/objects-map/model/types.ts";
import { ProviderBridgeClient } from "../../../../../packages/abstract-react-client/src/ports/bridge.tsx";
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
 * Холст карты — компоненты встроенного плагина `objects-map` (решение 0044), а не часть клиента.
 * Собирает их тот же сборщик, что на карте (esbuild в WebAssembly), с `@xyflow/react` из
 * зависимостей плагина, а выполняет та же ячейка метрики: значит, проверяется путь, которым холст
 * доходит до экрана. У клиента нет `react-dom`, поэтому это живёт здесь.
 */

const slash = (path: string) => path.replaceAll("\\", "/");
const repo = slash(join(dirname(fileURLToPath(import.meta.url)), "../../../../.."));
const plugin = `${repo}/packages/plugins/registry/objects-map`;

const require = createRequire(import.meta.url);
const builder = new BuildComponent(
  {
    read: (path) => readFile(path, "utf8").catch(() => undefined),
    list: async (path) =>
      (await readdir(path, { withFileTypes: true }).catch(() => [])).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
    // Пакеты pnpm лежат по ссылкам, и свои зависимости находят от настоящего пути.
    realpath: (path) => realpath(path).catch(() => undefined),
  },
  { now: () => "now" },
  {
    wasm: () =>
      readFile(join(dirname(require.resolve("esbuild-wasm/package.json")), "esbuild.wasm")),
  },
);

const view: ObjectsMap = {
  view: "mapward://_metrics/children",
  nodes: [
    {
      id: "mapward://packages/core",
      kind: "object",
      label: "Ядро карты",
      link: "mapward://packages/core",
      object: "mapward://packages/core",
      shape: "rect",
      view: "simple",
      expanded: false,
      position: { x: 0, y: 0 },
    },
  ],
  relations: [],
  shapes: [],
  palette: {
    objects: [{ prototype: "mapward://prototypes/package", label: "Пакет" }],
    relations: [],
  },
  canPlaceObjects: true,
  canPlaceRelations: false,
};

let scratch = "";
let entry: ComponentBuild;
let canvas: ComponentBuild;

beforeAll(async () => {
  // Сам холст первым кадром: вьюха метрики ждёт поток процесса, а он на сервере не придёт.
  scratch = slash(await mkdtemp(join(tmpdir(), "mapward-canvas-")));
  await writeFile(
    `${scratch}/canvas.tsx`,
    [
      'import { ObjectCard } from "@mapward/component";',
      `import { Canvas } from ${JSON.stringify(`${plugin}/canvas/canvas.tsx`)};`,
      "const answer = () => Promise.resolve({ ok: false as const, error: 'нет' });",
      "export default function View(props: { params: { view: never } }) {",
      "  const port = { mapPath: '/map', edit: answer, undo: answer, redo: answer, open: () => {}, Card: ObjectCard };",
      "  return <Canvas map={props.params.view} port={port} />;",
      "}",
    ].join("\n"),
    "utf8",
  );
  const [built, harness] = await Promise.all([
    builder.run({ entry: `${plugin}/view.tsx`, basePath: repo }),
    builder.run({ entry: `${scratch}/canvas.tsx`, basePath: repo }),
  ]);
  entry = built.build;
  canvas = harness.build;
}, 120_000);

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

const PROVIDED = ["@mapward/component", "react", "react-dom", "react/jsx-runtime", "rxjs"];

/** Что модуль просит у страницы: всё остальное сборка вложила в себя. */
const required = (code: string) =>
  new Set([...code.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]));

test("холст собирается сборщиком карты; React и react-dom — те, что отдаёт карта", () => {
  for (const build of [entry, canvas]) {
    expect(build.errors).toBeUndefined();
    // Одна копия React на странице: xyflow и zustand берут её у ячейки, а не вкладывают свою.
    for (const name of required(build.code ?? "")) expect(PROVIDED).toContain(name);
    expect(build.code).not.toMatch(/react-dom\.(production|development)/);
    // Стили xyflow едут рядом с tailwind компонента.
    expect(build.css).toContain(".react-flow");
  }
  expect(required(canvas.code ?? "")).toContain("react-dom");
});

const bridge = new Proxy({}, { get: () => () => NEVER }) as unknown as BridgeClient<AppBridge>;

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
      label: ref.run,
      description: undefined,
      missing: false,
      running: 0,
      run: () => {},
    }),
  },
  Card: () => null,
};

function render(build: ComponentBuild, asked: unknown[] = []) {
  const kit: PluginKit = {
    call: (pluginPath, method, args) => {
      asked.push({ plugin: pluginPath, method, args });
      return NEVER;
    },
    resolve: (path) => path,
  };
  return renderToString(
    createElement(ProviderBridgeClient, {
      client: bridge,
      children: createElement(ProvideViewStates, {
        states: new ViewStates(bridge),
        children: createElement(ProvideMetrics, {
          port,
          children: createElement(ProvideNavigation, {
            navigation: { open: () => {}, tabs: false },
            children: createElement(ProvidePluginKit, {
              kit,
              children: createElement(ComponentDisplay, {
                build,
                display: {
                  params: { view },
                  object: { address: "mapward://", name: "Карта", path: "/map", props: {} },
                  metric: { key: "children", address: view.view, label: "Карта" },
                },
                links: {},
              }),
            }),
          }),
        }),
      }),
    }),
  );
}

test("первым кадром холст ставит рамку xyflow и рейку с палитрой вьюхи", () => {
  const html = render(canvas);
  // Узлы xyflow рисует после замера в браузере — в первом кадре на сервере их нет. Здесь видно,
  // что холст плагина дошёл до экрана: рамка xyflow и рейка с прототипом из палитры вьюхи.
  expect(html).toContain("react-flow");
  expect(html).toContain("Пакет");
});

test("вьюха метрики, пока процесс не ответил, говорит, что рисует", () => {
  const asked: unknown[] = [];
  expect(render(entry, asked)).toContain("рисую вьюху");
  // Первый кадр ничего не зовёт — подписка живёт, пока вид смонтирован.
  expect(asked).toEqual([]);
});
