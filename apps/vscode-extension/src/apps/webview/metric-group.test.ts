import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NEVER } from "rxjs";
import { expect, test } from "vitest";
import type { AppBridge, BridgeClient, MapMetric, MapObject, MetricGroup } from "@mapward/core";
import { ProviderBridgeClient } from "../../../../../packages/abstract-react-client/src/ports/bridge.tsx";
import { ViewStates } from "../../../../../packages/abstract-react-client/src/services/state/adapters/view-state.ts";
import { ProvideViewStates } from "../../../../../packages/abstract-react-client/src/services/state/ports.tsx";
import { MetricGrid } from "../../../../../packages/abstract-react-client/src/features/metrics/compose/metric-grid.tsx";
import {
  ProvideMetrics,
  type MetricsPort,
} from "../../../../../packages/abstract-react-client/src/features/metrics/ports.tsx";
import { ComponentBuilds } from "../../../../../packages/abstract-react-client/src/features/metrics/adapters/component-builds.ts";
import { CallMemory } from "../../../../../packages/abstract-react-client/src/features/metrics/model/call-memory.ts";

/**
 * Метрики группы — раскладкой из поля `layout` или вертикальным списком. У клиента нет
 * `react-dom`, поэтому первый кадр проверяется здесь: без раскладки метрики идут строками в
 * порядке группы, с ней — ждут её. Сама раскладка на `Grid` плагина `views` — в `views.test.ts`.
 */

/** Мост первого кадра: подписки молчат, вызовы не отвечают. */
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

const metric = (key: string, label: string) =>
  ({
    key,
    address: `mapward://core/_metrics/${key}`,
    config: { label, component: "/map/_plugins/views/text.tsx" },
    layers: [],
  }) as unknown as MapMetric;

const docs = metric("docs", "Доки");
const code = metric("code", "Код");
const core = {
  address: "mapward://core",
  name: "core",
  path: "/map/core",
  props: {},
  metrics: [code, docs],
} as unknown as MapObject;

const grid = (group: MetricGroup) =>
  renderToString(
    createElement(ProviderBridgeClient, {
      client: bridge,
      children: createElement(ProvideViewStates, {
        states: new ViewStates(bridge),
        children: createElement(ProvideMetrics, {
          port,
          children: createElement(MetricGrid, { object: core, metrics: [docs, code], group }),
        }),
      }),
    }),
  );

test("без layout — вертикальный список: клетка на метрику, раскладку не ждёт", () => {
  const html = grid({ key: "всё", metrics: ["docs", "code"] });

  // Любая метрика — компонент со своей рамкой (у готовых видов — плагин `views`): первым кадром
  // каждая клетка собирает свой компонент.
  expect(html.match(/собирается/g)).toHaveLength(2);
});

test("с layout метрики ждут раскладку: пока она собирается, не монтируется ни одна", () => {
  const html = grid({ key: "всё", metrics: ["docs", "code"], layout: "/map/layout.tsx" });

  expect(html).toContain("собирается");
  expect(html).not.toContain("Доки");
});
