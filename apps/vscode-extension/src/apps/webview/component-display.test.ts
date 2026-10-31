import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NEVER } from "rxjs";
import { expect, test } from "vitest";
import { ComponentDisplay } from "../../../../../packages/abstract-react-client/src/features/metrics/compose/component-display.tsx";
import type { AppBridge, BridgeClient, MapObject } from "@mapward/core";
import {
  ProvideMetrics,
  type MetricsPort,
} from "../../../../../packages/abstract-react-client/src/features/metrics/ports.tsx";
import { ComponentBuilds } from "../../../../../packages/abstract-react-client/src/features/metrics/adapters/component-builds.ts";
import { CallMemory } from "../../../../../packages/abstract-react-client/src/features/metrics/model/call-memory.ts";

/**
 * Ячейка компонента метрики — решение 0037. У клиента нет `react-dom`, поэтому рендер
 * проверяется здесь, первым кадром на сервере. Ловушку ошибок отрисовки так не проверить:
 * серверный рендер её не зовёт.
 */

const display = {
  params: { items: [{ label: "урок 1", status: "success" }] },
  object: { address: "mapward://", name: "Корень", path: "/map", props: {} },
  metric: { key: "tx", address: "mapward://_metrics/tx", label: "Транскрибация" },
};

const links = {};

const render = (props: Partial<Parameters<typeof ComponentDisplay>[0]>) =>
  renderToString(createElement(ComponentDisplay, { build: undefined, display, links, ...props }));

test("собранный компонент рисуется со своим css и получает API окна, без кирпичей", () => {
  const code = [
    'var jsx = require("react/jsx-runtime");',
    'var kit = require("@mapward/component");',
    "module.exports = { default: function View(props) {",
    '  return jsx.jsxs("section", { className: "p-2", children: [props.metric.label, " ", Object.keys(kit).sort().join(",")] });',
    "} };",
  ].join("\n");
  const html = render({ build: { code, css: ".p-2{padding:8px}", builtAt: "now" } });

  expect(html).toContain("Транскрибация");
  // Кирпичи — код плагина `views`: в набор окна они не входят.
  expect(html).toContain(
    "ObjectCard,useAction,useMutation,useNavigation,usePlugin,useQuery,useStream,useViewState",
  );
  expect(html).toContain(".p-2{padding:8px}");
});

test("не собрался — ошибки сборки в ячейке", () => {
  const html = render({
    build: { errors: ["display.tsx:1:8: не найден пакет x"], builtAt: "now" },
  });
  expect(html).toContain("компонент не собрался");
  expect(html).toContain("не найден пакет x");
});

test("сборка ещё идёт", () => {
  expect(render({})).toContain("собирается");
});

/** Решение 0038: `useAction` ищет экшон у объекта ячейки и отдаёт то, что сказали экшоны порта. */
test("useAction — экшон объекта ячейки: подпись и идущие прогоны от экшонов", () => {
  const code = [
    'var jsx = require("react/jsx-runtime");',
    'var kit = require("@mapward/component");',
    "module.exports = { default: function View() {",
    '  var release = kit.useAction("release", { env: "stage" });',
    '  return jsx.jsx("b", { children: release.label + " " + release.running + " " + release.missing });',
    "} };",
  ].join("\n");
  const asked: string[] = [];
  const silent = new Proxy({}, { get: () => () => NEVER }) as unknown as BridgeClient<AppBridge>;
  const port: MetricsPort = {
    ref: { mapPath: "/map", basePath: "/", name: "Карта" },
    builds: new ComponentBuilds(silent, { mapPath: "/map", basePath: "/", name: "Карта" }),
    calls: new CallMemory(),
    params: (_object, metric) => metric.config.params ?? {},
    goTo: () => {},
    actions: {
      changed$: NEVER,
      source: () => undefined,
      handle: (object, ref) => {
        asked.push(`${object.address} ${ref.run} ${JSON.stringify(ref.inputs)}`);
        return {
          label: "Выпустить",
          description: undefined,
          missing: false,
          running: 1,
          run: () => {},
        };
      },
    },
    Card: () => null,
  };
  const object = { address: "mapward://core", actions: [] } as unknown as MapObject;
  const html = renderToString(
    createElement(ProvideMetrics, {
      port,
      children: createElement(ComponentDisplay, {
        build: { code, builtAt: "now" },
        display,
        links: { object },
      }),
    }),
  );

  expect(html).toContain("Выпустить 1 false");
  expect(asked).toEqual(['mapward://core release {"env":"stage"}']);
});
