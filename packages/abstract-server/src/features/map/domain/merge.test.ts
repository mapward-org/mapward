import { expect, test } from "vitest";
import { mergeIndex, mergeMetric } from "./merge.ts";

/**
 * An object without its own field keeps the prototype's. Spreading `own` with the key present
 * and undefined used to overwrite it: the object lost what it inherited without saying a word.
 */
test("an absent field does not erase the one it inherits", () => {
  const merged = mergeIndex(
    { name: "Пакет", extends: "mapward://prototypes/system" },
    { name: "core", extends: undefined, props: { codePath: "packages/core" } },
  );

  expect(merged.extends).toBe("mapward://prototypes/system");
  expect(merged.name).toBe("core");
  expect(merged.props).toEqual({ codePath: "packages/core" });
});

test("a metric heir that sets one param keeps the rest of the prototype's params", () => {
  const merged = mergeMetric(
    {
      label: "Линтер",
      component: "/map/_plugins/views/status.tsx",
      params: { source: { plugin: "/map/_plugins/agent", method: "ask" }, refresh: "refresh" },
    },
    { params: { collapsed: true } },
  );

  expect(merged.component).toBe("/map/_plugins/views/status.tsx");
  expect(merged.params).toEqual({
    source: { plugin: "/map/_plugins/agent", method: "ask" },
    refresh: "refresh",
    collapsed: true,
  });
});
