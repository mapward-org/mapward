import { describe, expect, it } from "vitest";
import type { MapFile } from "@mapward/core";
import {
  activeDirectives,
  directiveHintClass,
  directiveLabel,
  matchDirectives,
  newestFirst,
  statusColor,
} from "./directives.ts";

const file = (name: string, status?: MapFile["status"]): MapFile =>
  ({
    name,
    path: `/map/_directives/${name}`,
    ...(status === undefined ? {} : { status }),
  }) as MapFile;

const run = (one: MapFile, stage: string, finished?: boolean): MapFile =>
  ({
    ...one,
    run: { stage, startedAt: "2026-09-21T00:00:00Z", ...(finished ? { finishedAt: "z" } : {}) },
  }) as MapFile;

describe("directiveLabel", () => {
  it("снимает дату, время и расширение", () => {
    expect(directiveLabel(file("2026-09-21-0031-исправить-багу.md"))).toBe("исправить-багу");
  });

  it("имя без даты оставляет собой", () => {
    expect(directiveLabel(file("create-base.md"))).toBe("create-base");
  });

  it("дату внутри имени не трогает", () => {
    expect(directiveLabel(file("отчёт-за-2026-09-21-0031-итог.md"))).toBe(
      "отчёт-за-2026-09-21-0031-итог",
    );
  });
});

describe("directiveHintClass", () => {
  it("серое — только у не запускавшейся новой", () => {
    expect(directiveHintClass(file("2026-09-21-0031-новая.md", "new"))).toBe(statusColor.new);
  });

  it("прогон был — этап синим, даже когда статус новый", () => {
    const one = run(file("2026-09-21-0031-новая.md", "new"), "Реализация", true);
    expect(directiveHintClass(one)).not.toBe(statusColor.new);
  });

  it("без прогона цвет берётся по статусу", () => {
    expect(directiveHintClass(file("2026-09-21-0031-выполнена.md", "done"))).toBe(statusColor.done);
  });
});

describe("activeDirectives", () => {
  it("оставляет незакрытые и переворачивает порядок", () => {
    const files = [
      file("2026-09-01-0001-первая.md", "done"),
      file("2026-09-02-0002-вторая.md", "new"),
      file("2026-09-03-0003-третья.md", "changed"),
    ];
    expect(activeDirectives(files).map((one) => directiveLabel(one))).toEqual(["третья", "вторая"]);
  });

  it("статуса нет — директива считается новой", () => {
    expect(activeDirectives([file("2026-09-01-0001-без-статуса.md")])).toHaveLength(1);
  });
});

describe("newestFirst", () => {
  it("выполненные из списка не убирает", () => {
    const files = [file("2026-09-01-0001-первая.md", "done"), file("2026-09-02-0002-вторая.md")];
    expect(newestFirst(files).map((one) => one.name)).toEqual([
      "2026-09-02-0002-вторая.md",
      "2026-09-01-0001-первая.md",
    ]);
  });
});

describe("matchDirectives", () => {
  const files = [
    file("2026-09-21-0031-исправить-багу.md"),
    file("2026-09-23-0208-мини-поиск-по-директивам.md"),
  ];
  const names = (query: string) => matchDirectives(files, query).map((one) => one.name);

  it("пустой запрос ничего не отбирает", () => {
    expect(names("  ")).toHaveLength(2);
  });

  it("ищет подстроку без регистра", () => {
    expect(names("ПОИСК")).toEqual(["2026-09-23-0208-мини-поиск-по-директивам.md"]);
  });

  it("пробел в запросе находит дефис в имени", () => {
    expect(names("мини поиск")).toEqual(["2026-09-23-0208-мини-поиск-по-директивам.md"]);
  });

  it("дата в имени — тоже поиск", () => {
    expect(names("2026-09-21")).toEqual(["2026-09-21-0031-исправить-багу.md"]);
  });
});
