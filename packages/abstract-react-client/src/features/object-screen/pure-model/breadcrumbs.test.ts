import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import { breadcrumbTrail } from "./breadcrumbs.ts";

const object = (address: string, name: string, extra: Partial<MapObject> = {}): MapObject =>
  ({
    address,
    path: `/map/${address.replace("mapward://", "")}`,
    name,
    isGroup: false,
    props: {},
    layers: [],
    metrics: [],
    directives: [],
    actions: [],
    workflow: [],
    metricGroups: [],
    children: [],
    ...extra,
  }) as unknown as MapObject;

const map = object("mapward://", "Карта", {
  children: [
    object("mapward://packages", "packages", {
      isGroup: true,
      children: [
        object("mapward://packages/core", "core", {
          children: [object("mapward://packages/core/entry", "entry")],
        }),
      ],
    }),
  ],
});

test("группа в крошки не попадает: за ней нет объекта", () => {
  expect(breadcrumbTrail(map, "mapward://packages/core")).toEqual([
    { address: "mapward://", name: "Карта" },
  ]);
});

test("объекты пути остаются на местах", () => {
  expect(breadcrumbTrail(map, "mapward://packages/core/entry")).toEqual([
    { address: "mapward://", name: "Карта" },
    { address: "mapward://packages/core", name: "core" },
  ]);
});

test("сам объект в крошки не идёт — он написан заголовком рядом", () => {
  expect(breadcrumbTrail(map, "mapward://")).toEqual([]);
});

/** Кнопка назад берёт последнюю крошку, поэтому пустой путь значит «идти некуда». */
test("ребёнок группы под корнем-группой остаётся без пути", () => {
  const rootless = object("mapward://", "Карта", {
    isGroup: true,
    children: [
      object("mapward://packages", "packages", {
        isGroup: true,
        children: [object("mapward://packages/core", "core")],
      }),
    ],
  });

  expect(breadcrumbTrail(rootless, "mapward://packages/core")).toEqual([]);
});
