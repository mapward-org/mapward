import { expect, test } from "vitest";
import type { MapMetric, MapObject } from "@mapward/core";
import { metricParams } from "./metric-params.ts";

const core = { address: "mapward://packages/core" } as MapObject;
const tree = {
  key: "tree",
  config: { params: { maxHeight: 200, empty: "пусто" } },
} as unknown as MapMetric;
const other = { key: "code", config: { params: { maxHeight: 200 } } } as unknown as MapMetric;

test("снимок перекрывает params только снимаемой метрики, слиянием по ключу", () => {
  const override = { object: core.address, metric: "tree", params: { maxHeight: 900 } };

  expect(metricParams(core, tree, override)).toEqual({ maxHeight: 900, empty: "пусто" });
  expect(metricParams(core, other, override)).toEqual({ maxHeight: 200 });
  expect(metricParams(core, tree, undefined)).toEqual({ maxHeight: 200, empty: "пусто" });
});
