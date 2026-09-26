import { expect, test } from "vitest";
import { focusTarget } from "../pure-model/focus-target.ts";
import { ShownTabs } from "./shown-tabs.ts";

const core = { mapPath: "d:/map", address: "mapward://packages/core" };
const cli = { mapPath: "d:/map", address: "mapward://packages/cli" };

test("переход вкладки меняет объект, а не её место в очереди активных", () => {
  const tabs = new ShownTabs<string>();
  tabs.show("a", core);
  tabs.show("b", core);
  tabs.show("b", cli);
  expect(focusTarget(tabs.list(), core)).toEqual({ kind: "tab", tab: "a" });
});

test("активированная позже вкладка побеждает", () => {
  const tabs = new ShownTabs<string>();
  tabs.show("a", core);
  tabs.show("b", core);
  tabs.activate("a");
  expect(focusTarget(tabs.list(), core)).toEqual({ kind: "tab", tab: "a" });
});

test("закрытая вкладка уходит", () => {
  const tabs = new ShownTabs<string>();
  tabs.show("a", core);
  tabs.close("a");
  expect(focusTarget(tabs.list(), core)).toEqual({ kind: "sidebar" });
});
