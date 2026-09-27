import { expect, test } from "vitest";
import { ago, toDisplay } from "./display.ts";

test("a map is an objects-map view: without a view address it is the wrong shape", () => {
  expect(toDisplay("map", { nodes: [], relations: [] }).kind).toBe("unknown");
});

test("an old cached view without shapes or palette still draws", () => {
  const data = toDisplay("map", { view: "mapward://_metrics/canvas", nodes: [] });
  expect(data).toMatchObject({
    kind: "map",
    view: "mapward://_metrics/canvas",
    relations: [],
    shapes: [],
    palette: { objects: [], relations: [] },
  });
});

test("the age of a value shows only once it is stale", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  expect(ago(undefined, now)).toBeUndefined();
  expect(ago(at(0), now)).toBeUndefined();
  expect(ago(at(9), now)).toBeUndefined();
  expect(ago(at(25), now)).toBe("25 мин назад");
  expect(ago(at(180), now)).toBe("3 ч назад");
  expect(ago(at(3 * 24 * 60), now)).toBe("3 д назад");
});
