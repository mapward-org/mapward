import { expect, test } from "vitest";
import type { MapObject, MetricGroup } from "@mapward/core";
import { CheckTarget } from "./check-target.ts";

/**
 * Проверка объекта видит и метрики, названные унаследованными группами: группа прототипа помнит
 * удалённую метрику — это ошибка; метрика, которую определяют наследники, — нет.
 */

const ref = { mapPath: "/map", basePath: "/", name: "Карта" };

const object = (
  address: string,
  metrics: string[],
  groups: MetricGroup[],
  children: MapObject[] = [],
) =>
  ({
    address,
    name: address,
    path: `/map/${address}`,
    isGroup: false,
    props: {},
    layers: [],
    metrics: metrics.map((key) => ({ key, address: `${address}/_metrics/${key}`, config: {} })),
    metricGroups: groups,
    actions: [],
    directives: [],
    workflow: [],
    children,
  }) as unknown as MapObject;

const all: MetricGroup = { key: "всё", metrics: ["code", "version", "docs"] };

const prototype = object("mapward://prototypes/package", ["code"], [all]);
const core = object("mapward://packages/core", ["code", "version"], [all]);
const root = object("mapward://", [], [], [prototype, core]);

const checks = new CheckTarget(
  {
    metric: () => Promise.reject(new Error("не звать")),
    layout: () => Promise.reject(new Error("не звать")),
    actionForm: () => Promise.reject(new Error("не звать")),
  },
  {} as never,
);

test("удалённая метрика в группе — ошибка, метрика наследника у прототипа — нет", async () => {
  const report = await checks.run(ref, root, prototype.address, 1000);
  const group = report.steps.find((step) => step.title === "группа «всё»: метрики");

  expect(report.ok).toBe(false);
  expect(group?.status).toBe("fail");
  expect(group?.lines).toEqual([
    "version: у этого объекта нет, есть у 1 с этой группой",
    "docs: метрики нет ни у этого объекта, ни у объектов с этой группой",
  ]);
});
