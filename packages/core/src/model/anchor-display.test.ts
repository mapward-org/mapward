import { expect, test } from "vitest";
import { anchorDisplay } from "./anchor-display.ts";

test("пути компонента и схемы — от папки того config.json, где они написаны", () => {
  const config = anchorDisplay(
    { display: { kind: "component", component: "./display.tsx", schema: "../shared/schema.json" } },
    "D:/map/_metrics/tx/config.json",
  );
  expect(config.display?.component).toBe("D:/map/_metrics/tx/display.tsx");
  expect(config.display?.schema).toBe("D:/map/_metrics/shared/schema.json");
});

test("схема объектом и абсолютный путь не трогаются", () => {
  const schema = { type: "object" };
  const config = anchorDisplay(
    { display: { kind: "component", component: "/abs/display.tsx", schema } },
    "/map/_metrics/tx/config.json",
  );
  expect(config.display?.component).toBe("/abs/display.tsx");
  expect(config.display?.schema).toBe(schema);
});
