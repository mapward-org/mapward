import { expect, test } from "vitest";
import { childrenMap } from "./children.ts";
import type { MapObject } from "./model.ts";

const object = (address: string, name: string, extra: Partial<MapObject> = {}): MapObject =>
  ({
    address,
    path: `/map/${address.replace("mapward://", "")}`,
    name,
    isGroup: false,
    props: {},
    metrics: [],
    directives: [],
    actions: [],
    workflow: [],
    children: [],
    ...extra,
  }) as MapObject;

const map = object("mapward://", "Карта", {
  children: [
    object("mapward://packages", "packages", {
      isGroup: true,
      children: [
        object("mapward://packages/core", "core"),
        object("mapward://packages/docs", "docs"),
      ],
    }),
    object("mapward://apps", "apps", {
      isGroup: true,
      children: [object("mapward://apps/cli", "CLI")],
    }),
    object("mapward://relations/core-to-docs", "использует", {
      props: { from: "mapward://packages/core", to: "mapward://packages/docs" },
    }),
  ],
});

test("include picks what goes on the map, exclude cuts a branch away", () => {
  const all = childrenMap(map);
  expect(all.nodes.map((node) => node.label)).toEqual(["core", "docs", "CLI"]);
  expect(all.relations).toHaveLength(1);

  const cut = childrenMap(map, ["packages/*"]);
  expect(cut.nodes.map((node) => node.label)).toEqual(["CLI"]);

  // Отбор спрашивается у того, кто попал бы на карту: группа `packages` под глоб не подходит,
  // но её детей это не вычёркивает — иначе `include` не отбирал бы, а стирал.
  const only = childrenMap(map, [], ["packages/*"]);
  expect(only.nodes.map((node) => node.label)).toEqual(["core", "docs"]);
  expect(only.relations).toHaveLength(0);

  // Пустой список значит «всё», а не «ничего».
  expect(childrenMap(map, [], []).nodes).toHaveLength(3);
});

test("a node is a card of its object, with the group and size of the map", () => {
  const [plain] = childrenMap(map).nodes;
  expect(plain).toEqual({
    label: "core",
    link: "mapward://packages/core",
    object: "mapward://packages/core",
  });

  // Вкладка и размер — у всех узлов сразу: их задаёт место, где карточки нарисованы.
  const [card] = childrenMap(map, [], [], {
    group: "превью",
    width: 320,
    maxHeight: "200px",
  }).nodes;
  expect(card).toMatchObject({ object: "mapward://packages/core", group: "превью", width: 320 });
  expect(card?.maxHeight).toBe("200px");
});
