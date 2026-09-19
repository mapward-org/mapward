import { expect, test } from "vitest";
import { project, projectDeep } from "./projection.ts";

const object = {
  address: "mapward://packages/core",
  name: "core",
  props: { codePath: "packages/core" },
  metrics: [
    { key: "version", label: "Версия", value: { data: { text: "0.0.0" } }, config: { big: true } },
    { key: "tests", label: "Тесты", value: undefined, config: { big: true } },
  ],
  children: [{ address: "mapward://packages/core/x", name: "x" }],
};

test("no fields means the whole value", () => {
  expect(project(object, undefined)).toBe(object);
  expect(project(object, [])).toBe(object);
});

test("a top-level field comes whole", () => {
  expect(project(object, ["props"])).toEqual({ props: { codePath: "packages/core" } });
});

test("a dotted path reaches into every item of a list", () => {
  expect(project(object, ["metrics.key", "metrics.value"])).toEqual({
    metrics: [{ key: "version", value: { data: { text: "0.0.0" } } }, { key: "tests" }],
  });
});

test("asking for a branch beats asking for its leaf", () => {
  expect(project(object, ["metrics", "metrics.key"])).toEqual({ metrics: object.metrics });
});

test("fields that are not there are skipped, not nulled", () => {
  expect(project(object, ["name", "нет-такого"])).toEqual({ name: "core" });
});

test("a deep projection applies the same fields all the way down", () => {
  const tree = {
    address: "mapward://",
    name: "карта",
    props: { a: 1 },
    children: [
      {
        address: "mapward://packages",
        name: "packages",
        props: { b: 2 },
        children: [{ address: "mapward://packages/core", name: "core", props: { c: 3 } }],
      },
    ],
  };

  // Глубина не должна стоить длины проекции: `children.children.address` никто не пишет.
  expect(projectDeep(tree, ["address"])).toEqual({
    address: "mapward://",
    children: [
      {
        address: "mapward://packages",
        children: [{ address: "mapward://packages/core" }],
      },
    ],
  });
});

test("the heavy part is what gets left out", () => {
  const light = project(object, ["metrics.key", "metrics.label"]) as { metrics: unknown[] };
  expect(JSON.stringify(light).includes("big")).toBe(false);
});
