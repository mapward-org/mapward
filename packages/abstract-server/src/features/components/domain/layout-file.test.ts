import { expect, test } from "vitest";
import { layoutFile } from "./layout-file.ts";

test("адрес раскладки ведёт в папку карты, проекта или объекта", () => {
  const places = { mapPath: "/repo/map", basePath: "/repo", objectPath: "/repo/map/packages/core" };
  expect(layoutFile("mapward://prototypes/package/layout.tsx", places)).toBe(
    "/repo/map/prototypes/package/layout.tsx",
  );
  expect(layoutFile("mapward://@/layouts/wide.tsx", places)).toBe("/repo/layouts/wide.tsx");
  expect(layoutFile("mapward://~/layout.tsx", places)).toBe("/repo/map/packages/core/layout.tsx");
  expect(layoutFile("/abs/layout.tsx", places)).toBe("/abs/layout.tsx");
  // Поле объекта — не файл.
  expect(layoutFile("mapward://prototypes/package#props.layout", places)).toBeUndefined();
});
