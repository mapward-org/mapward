import { expect, test } from "vitest";
import { focusTarget, type ShownTab } from "./focus-target.ts";

const shown = (
  tab: string,
  address: string,
  activeAt: number,
  mapPath = "d:/map",
): ShownTab<string> => ({
  tab,
  mapPath,
  address,
  activeAt,
});

const core = { mapPath: "d:/map", address: "mapward://packages/core" };

test("вкладок нет — сайдбар", () => {
  expect(focusTarget([], core)).toEqual({ kind: "sidebar" });
});

test("вкладка на объекте — она", () => {
  expect(focusTarget([shown("a", core.address, 1)], core)).toEqual({ kind: "tab", tab: "a" });
});

test("несколько вкладок на объекте — активная последней", () => {
  const tabs = [
    shown("a", core.address, 3),
    shown("b", core.address, 7),
    shown("c", core.address, 5),
  ];
  expect(focusTarget(tabs, core)).toEqual({ kind: "tab", tab: "b" });
});

test("вкладка ушла на другой объект — не она", () => {
  const tabs = [shown("a", "mapward://packages/cli", 9)];
  expect(focusTarget(tabs, core)).toEqual({ kind: "sidebar" });
});

test("тот же адрес в другой карте — не она", () => {
  const tabs = [shown("a", core.address, 9, "d:/other")];
  expect(focusTarget(tabs, core)).toEqual({ kind: "sidebar" });
});
