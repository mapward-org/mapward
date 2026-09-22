import { expect, test } from "vitest";
import type { MapFile, MapObject, MapStage } from "@mapward/core";
import { locateDirective } from "./locate.ts";

const stage = (name: string, order: number): MapStage => ({
  name,
  order,
  marksDone: false,
  path: `d:/map/prototypes/base/_directives.workflow/${name}.md`,
});

const object = (
  address: string,
  extra: { directives?: MapFile[]; workflow?: MapStage[]; children?: MapObject[] } = {},
): MapObject =>
  ({
    address,
    path: `d:/map/${address}`,
    name: address,
    directives: extra.directives ?? [],
    workflow: extra.workflow ?? [],
    children: extra.children ?? [],
  }) as unknown as MapObject;

const core = object("packages/core", {
  directives: [
    { name: "2026-09-22-0001-x.md", path: "d:/map/packages/core/_directives/2026-09-22-0001-x.md" },
  ],
  workflow: [stage("План", 20), stage("Брейншторм", 10)],
});
const root = object("", { children: [object("packages", { children: [core] })] });

test("a directive file is found on its object, with the stages in order", () => {
  const found = locateDirective(root, "D:\\map\\packages\\core\\_directives\\2026-09-22-0001-x.md");
  expect(found?.object.address).toBe("packages/core");
  expect(found?.directive).toBe("2026-09-22-0001-x.md");
  expect(found?.stages.map((entry) => entry.name)).toEqual(["Брейншторм", "План"]);
});

test("a file outside every _directives gets no buttons", () => {
  expect(locateDirective(root, "d:/map/packages/core/README.md")).toBeUndefined();
});

test("an inherited directive belongs to the object that owns the file", () => {
  // У наследника тот же файл лежит в списке с owner: кнопки должны вести к владельцу.
  const prototype = object("prototypes/base", {
    directives: [{ name: "shared.md", path: "d:/map/prototypes/base/_directives/shared.md" }],
    workflow: [stage("План", 20)],
  });
  const heir = object("packages/docs", {
    directives: [
      {
        name: "shared.md",
        path: "d:/map/prototypes/base/_directives/shared.md",
        owner: "prototypes/base",
      },
    ],
  });
  const map = object("", { children: [heir, prototype] });
  expect(locateDirective(map, "d:/map/prototypes/base/_directives/shared.md")?.object.address).toBe(
    "prototypes/base",
  );
});
