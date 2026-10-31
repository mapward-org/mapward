import { expect, test } from "vitest";
import { soloGrid } from "./grid.ts";

/**
 * Таб одной метрики: областей у него нет намеренно. Клетка, назвавшая область, которой в сетке
 * не объявили, встаёт по несуществующей линии вместо того, чтобы занять таб (решение 0026).
 */
test("a solo tab lays out with tracks and names no areas", () => {
  const plan = soloGrid("children");

  expect(plan.columns).toBe("minmax(0, 1fr)");
  expect(plan.rows).toBe("minmax(0, 1fr)");
  expect([...plan.placed]).toEqual(["children"]);
});
