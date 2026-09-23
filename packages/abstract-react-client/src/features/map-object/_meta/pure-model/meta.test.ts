import { describe, expect, it } from "vitest";
import type { MapAction, MapFile, MapMetric, MapObject, MapStage } from "@mapward/core";
import { searchMeta } from "./meta.ts";

const metric = (key: string, label?: string): MapMetric =>
  ({ key, config: label === undefined ? {} : { label } }) as unknown as MapMetric;

const action = (key: string, label?: string): MapAction =>
  ({ key, config: label === undefined ? {} : { label } }) as unknown as MapAction;

const stage = (name: string): MapStage => ({ name, order: 0, marksDone: false, path: "" });

const file = (name: string): MapFile => ({ name, path: `/map/_directives/${name}` }) as MapFile;

const object = {
  address: "mapward://packages/core",
  path: "/repo/packages/core",
  name: "core",
  props: { packageName: "@mapward/core" },
  metrics: [metric("files", "Файлы"), metric("tests")],
  workflow: [stage("Брейншторм"), stage("План")],
  actions: [action("release", "Выпустить версию")],
  directives: [file("2026-09-21-0031-исправить-багу.md"), file("2026-09-23-0208-мини-поиск.md")],
} as unknown as MapObject;

describe("searchMeta", () => {
  it("пустой запрос оставляет всё", () => {
    const found = searchMeta(object, " ");
    expect(found.object).toBe(true);
    expect(found.fields.map((row) => row.key)).toEqual(["адрес", "на диске", "packageName"]);
    expect(found.metrics).toHaveLength(2);
    expect(found.workflow).toHaveLength(2);
    expect(found.actions).toHaveLength(1);
    expect(found.directives).toHaveLength(2);
    expect(found.nothing).toBe(false);
  });

  it("метрика ищется и по подписи, и по ключу", () => {
    expect(searchMeta(object, "файлы").metrics.map((one) => one.key)).toEqual(["files"]);
    expect(searchMeta(object, "files").metrics.map((one) => one.key)).toEqual(["files"]);
  });

  it("поле ищется по ключу и по значению", () => {
    expect(searchMeta(object, "@mapward").fields.map((row) => row.key)).toEqual(["packageName"]);
    expect(searchMeta(object, "на диске").fields.map((row) => row.key)).toEqual(["на диске"]);
  });

  it("раздел «Объект» виден, если совпало одно имя", () => {
    const found = searchMeta({ ...object, name: "ядро" }, "ядро");
    expect(found.object).toBe(true);
    expect(found.fields).toEqual([]);
  });

  it("совпавшее в одном разделе не тянет за собой остальные", () => {
    const found = searchMeta(object, "план");
    expect(found.workflow.map((one) => one.name)).toEqual(["План"]);
    expect(found.object).toBe(false);
    expect(found.metrics).toEqual([]);
    expect(found.actions).toEqual([]);
    expect(found.directives).toEqual([]);
  });

  it("экшон — по подписи, директива — по дате в имени", () => {
    expect(searchMeta(object, "выпустить").actions.map((one) => one.key)).toEqual(["release"]);
    expect(searchMeta(object, "2026-09-21").directives.map((one) => one.name)).toEqual([
      "2026-09-21-0031-исправить-багу.md",
    ]);
  });

  it("не совпало нигде — так и сказано", () => {
    expect(searchMeta(object, "нет такого").nothing).toBe(true);
  });
});
