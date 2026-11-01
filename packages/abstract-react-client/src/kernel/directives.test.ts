import { describe, expect, it } from "vitest";
import type { MapFile } from "@mapward/core";
import {
  activeDirectives,
  directiveHint,
  directiveHintClass,
  directiveLabel,
  isRunning,
  matchDirectives,
  menuDirectives,
  newestFirst,
  statusColor,
  statusHint,
} from "./directives.ts";

const file = (name: string, status?: MapFile["status"]): MapFile =>
  ({
    name,
    path: `/map/_directives/${name}`,
    ...(status === undefined ? {} : { status }),
  }) as MapFile;

const at = (one: MapFile, stage: string): MapFile => ({ ...one, stage });

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
  it("серое — только у не запускавшейся", () => {
    expect(directiveHintClass(file("2026-09-21-0031-новая.md", "new"))).toBe(statusColor.new);
  });

  it("в работе — синим, и на идущем этапе, и в ожидании ответа", () => {
    const running = at(file("2026-09-21-0031-идёт.md", "running"), "Реализация");
    const waiting = at(file("2026-09-21-0031-ждёт.md", "waiting"), "План");
    expect(directiveHintClass(running)).not.toBe(statusColor.new);
    expect(directiveHintClass(waiting)).toBe(directiveHintClass(running));
  });

  it("закрытая — зелёная", () => {
    const one = at(file("2026-09-21-0031-выполнена.md", "done"), "Тестирование");
    expect(directiveHintClass(one)).toBe(statusColor.done);
  });
});

describe("directiveHint", () => {
  it("закрытая — «выполнена», а не последний этап", () => {
    const one = at(file("2026-09-21-0031-выполнена.md", "done"), "Тестирование");
    expect(directiveHint(one)).toBe(statusHint.done);
  });

  it("в работе — именем этапа, без многоточия", () => {
    expect(directiveHint(at(file("2026-09-21-0031-идёт.md", "running"), "Реализация"))).toBe(
      "реализация",
    );
    expect(directiveHint(at(file("2026-09-21-0031-ждёт.md", "waiting"), "План"))).toBe("план");
  });

  it("без статуса — новая", () => {
    expect(directiveHint(file("2026-09-21-0031-новая.md"))).toBe(statusHint.new);
  });
});

describe("isRunning", () => {
  it("идёт только директива со статусом running", () => {
    expect(isRunning(at(file("2026-09-21-0031-идёт.md", "running"), "План"))).toBe(true);
    expect(isRunning(at(file("2026-09-21-0031-ждёт.md", "waiting"), "План"))).toBe(false);
    expect(isRunning(file("2026-09-21-0031-новая.md"))).toBe(false);
  });
});

describe("activeDirectives", () => {
  it("оставляет незакрытые и переворачивает порядок", () => {
    const files = [
      file("2026-09-01-0001-первая.md", "done"),
      file("2026-09-02-0002-вторая.md", "new"),
      file("2026-09-03-0003-третья.md", "waiting"),
    ];
    expect(activeDirectives(files).map((one) => directiveLabel(one))).toEqual(["третья", "вторая"]);
  });

  it("статуса нет — директива считается новой", () => {
    expect(activeDirectives([file("2026-09-01-0001-без-статуса.md")])).toHaveLength(1);
  });
});

describe("menuDirectives", () => {
  it("все директивы: незакрытые сверху, выполненные под ними, внутри — от новых к старым", () => {
    const files = [
      file("2026-09-01-0001-первая.md", "done"),
      file("2026-09-02-0002-вторая.md", "new"),
      file("2026-09-03-0003-третья.md", "done"),
      file("2026-09-04-0004-четвёртая.md", "running"),
    ];
    expect(menuDirectives(files).map((one) => directiveLabel(one))).toEqual([
      "четвёртая",
      "вторая",
      "третья",
      "первая",
    ]);
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
