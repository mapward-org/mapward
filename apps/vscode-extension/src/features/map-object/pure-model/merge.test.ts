import { expect, test } from "vitest";
import { mergeIndex } from "./merge.ts";

/**
 * An object without its own layout keeps the prototype's. Spreading `own` with the key present
 * and undefined used to overwrite it, and the grid lost its areas: every cell landed in the same
 * place, as if positioned absolutely.
 */
test("an absent field does not erase the one it inherits", () => {
  const merged = mergeIndex(
    { name: "Пакет", "details-metrics-layout": { areas: [["code", "docs"]] } },
    { name: "core", "details-metrics-layout": undefined, props: { codePath: "packages/core" } },
  );

  expect(merged["details-metrics-layout"]).toEqual({ areas: [["code", "docs"]] });
  expect(merged.name).toBe("core");
  expect(merged.props).toEqual({ codePath: "packages/core" });
});
