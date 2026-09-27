import { expect, test } from "vitest";
import { toDisplay } from "./display.ts";

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
