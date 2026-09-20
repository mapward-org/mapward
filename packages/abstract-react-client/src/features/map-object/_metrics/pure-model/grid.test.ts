import { expect, test } from "vitest";
import { planGrid, soloGrid } from "./grid.ts";

test("a layout becomes named areas and equal columns", () => {
  const plan = planGrid(
    {
      areas: [
        ["files", "tests"],
        ["docs", "."],
      ],
    },
    ["files", "tests", "docs"],
  );

  expect(plan?.areas).toBe('"files tests" "docs ."');
  expect(plan?.columns).toBe("repeat(2, minmax(0, 1fr))");
  expect(plan?.rows).toBeUndefined();
});

test("a metric missing from the layout still counts as placed", () => {
  const plan = planGrid({ areas: [["files"]] }, ["files", "forgotten"]);

  expect([...(plan?.placed ?? [])]).toEqual(["files", "forgotten"]);
});

test("no layout means no plan at all", () => {
  expect(planGrid(undefined, ["files"])).toBeUndefined();
});

/**
 * Таб одной метрики: областей у него нет намеренно. Клетка, назвавшая область, которой в сетке
 * не объявили, встаёт по несуществующей линии вместо того, чтобы занять таб (решение 0026).
 */
test("a solo tab lays out with tracks and names no areas", () => {
  const plan = soloGrid("children");

  expect(plan.areas).toBeUndefined();
  expect(plan.columns).toBe("minmax(0, 1fr)");
  expect(plan.rows).toBe("minmax(0, 1fr)");
  expect([...plan.placed]).toEqual(["children"]);
});
