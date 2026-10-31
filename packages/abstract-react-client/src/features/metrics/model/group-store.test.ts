import { BehaviorSubject } from "rxjs";
import { expect, test } from "vitest";
import type { ComponentBuild, MapMetric, MapObject, MetricGroup } from "@mapward/core";
import { GroupStore, type LayoutBuild } from "./group-store.ts";

const metric = (key: string, label?: string) =>
  ({
    key,
    address: `mapward://core/_metrics/${key}`,
    config: label === undefined ? {} : { label },
    layers: [],
  }) as unknown as MapMetric;

const code = metric("code", "Код");
const tests = metric("tests");

const core = {
  address: "mapward://core",
  name: "core",
  path: "/map/core",
  props: { codePath: "packages/core" },
  metrics: [code, tests],
} as unknown as MapObject;

/** Сборки раскладок: что спросили и ресурс, в который тест кладёт сборку сам. */
function layouts() {
  const asked: [string, string][] = [];
  const build = new BehaviorSubject<ComponentBuild | undefined>(undefined);
  const feed: LayoutBuild = {
    changed$: build,
    get value() {
      return build.value;
    },
  };
  return {
    builds: {
      layout: (address: string, group: string) => {
        asked.push([address, group]);
        return feed;
      },
    },
    asked,
    build,
  };
}

test("без layout группа — вертикальный список в порядке metrics, раскладку не собирает", () => {
  const { builds, asked } = layouts();
  const group: MetricGroup = { key: "всё", metrics: ["tests", "code"] };
  const store = new GroupStore({ object: core, metrics: [tests, code], group }, builds);

  expect(store.mode).toBe("list");
  expect(store.metrics.map((one) => one.key)).toEqual(["tests", "code"]);
  expect(asked).toEqual([]);
});

test("у объекта без групп — тоже список", () => {
  const { builds } = layouts();
  expect(new GroupStore({ object: core, metrics: [code, tests] }, builds).mode).toBe("list");
});

test("с layout раскладка собирается по объекту и ключу группы и получает метрики группы", () => {
  const { builds, asked, build } = layouts();
  const group: MetricGroup = {
    key: "всё",
    label: "Всё",
    metrics: ["code", "tests"],
    layout: "/map/prototypes/package/layout.tsx",
  };
  const store = new GroupStore({ object: core, metrics: [code, tests], group }, builds);

  expect(store.mode).toBe("layout");
  expect(asked).toEqual([["mapward://core", "всё"]]);
  expect(store.layoutBuild).toBeUndefined();

  let changed = 0;
  store.changed$.subscribe(() => (changed += 1));
  build.next({ code: "module.exports = {}", builtAt: "now" });
  expect(changed).toBeGreaterThan(0);
  expect(store.layoutBuild?.code).toBe("module.exports = {}");

  // Узел метрики рисует вид — группа только раскладывает его по ключам и по порядку.
  const props = store.layoutProps((one) => `<${one.key}>`);
  expect(props?.list).toEqual([
    { key: "code", label: "Код", node: "<code>" },
    { key: "tests", label: "tests", node: "<tests>" },
  ]);
  expect(props?.metrics.code).toEqual({ key: "code", label: "Код", node: "<code>" });
  expect(props?.group).toEqual({ key: "всё", label: "Всё" });
  expect(props?.object).toEqual({
    address: "mapward://core",
    name: "core",
    path: "/map/core",
    props: { codePath: "packages/core" },
  });
});

test("таб одной метрики раскладку не спрашивает — метрика на весь таб", () => {
  const { builds, asked } = layouts();
  const group: MetricGroup = { key: "всё", metrics: ["code", "tests"], layout: "/l.tsx" };
  const store = new GroupStore(
    { object: core, metrics: [code, tests], group, solo: "tests" },
    builds,
  );

  expect(store.mode).toBe("solo");
  expect(store.metrics.map((one) => one.key)).toEqual(["tests"]);
  expect(store.soloStyle).toEqual({
    gridTemplateColumns: "minmax(0, 1fr)",
    gridTemplateRows: "minmax(0, 1fr)",
  });
  expect(asked).toEqual([]);
});
