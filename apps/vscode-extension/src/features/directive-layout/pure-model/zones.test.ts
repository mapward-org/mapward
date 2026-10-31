import { describe, expect, it } from "vitest";
import { centerZone, directiveZone, isDirectivePath, terminalZone } from "./zones.ts";

type Content = { directives?: boolean; terminals?: boolean; others?: boolean };

const group = (column: number, content: Content = {}) => ({
  column,
  directives: content.directives ?? false,
  terminals: content.terminals ?? false,
  others: content.others ?? false,
});

const files = (column: number) => group(column, { others: true });
const directives = (column: number) => group(column, { directives: true });
const terminals = (column: number) => group(column, { terminals: true });

describe("isDirectivePath", () => {
  it("директива — markdown в папке _directives", () => {
    expect(isDirectivePath("d:\\map\\_directives\\2026-10-29-1506-x.md")).toBe(true);
    expect(isDirectivePath("/map/packages/core/_directives/a.md")).toBe(true);
  });

  it("этап и вложенные файлы — не директивы", () => {
    expect(isDirectivePath("/map/_directives.workflow/План.md")).toBe(false);
    expect(isDirectivePath("/map/_directives/sub/a.md")).toBe(false);
    expect(isDirectivePath("/map/_directives/a.json")).toBe(false);
  });
});

describe("directiveZone", () => {
  it("одна группа — зоны директив ещё нет, центр ею не становится", () => {
    expect(directiveZone([directives(1)])).toBeUndefined();
  });

  it("берёт правую группу с директивами", () => {
    expect(directiveZone([files(1), directives(2), terminals(3)])).toBe(2);
  });

  it("гостья в центре зоной его не делает", () => {
    expect(directiveZone([group(1, { directives: true, others: true }), files(2)])).toBeUndefined();
  });

  it("узнаётся по содержимому, а не по запомненному номеру: центр разрезали — номера съехали", () => {
    // Была зона во второй колонке; центр разрезали надвое, зона стала третьей.
    expect(directiveZone([files(1), files(2), directives(3), terminals(4)], 2)).toBe(3);
  });

  it("группа из одних директив — зона, даже если её передвинули в первую колонку", () => {
    expect(directiveZone([directives(1), files(2), terminals(3)])).toBe(1);
  });

  it("из двух подходящих — запомненная", () => {
    expect(directiveZone([files(1), directives(2), directives(3)], 2)).toBe(2);
  });

  it("пустая запомненная группа держится — её не по чему узнать", () => {
    expect(directiveZone([files(1), group(2), terminals(3)], 2)).toBe(2);
    expect(directiveZone([files(1), group(2), terminals(3)], 4)).toBeUndefined();
  });
});

describe("terminalZone", () => {
  it("не центр и не группа директив", () => {
    expect(terminalZone([files(1), directives(2), terminals(3)], 2)).toBe(3);
    expect(
      terminalZone([group(1, { terminals: true, others: true }), directives(2)], 2),
    ).toBeUndefined();
  });

  it("узнаётся по содержимому, а не по запомненному номеру", () => {
    expect(terminalZone([files(1), files(2), directives(3), terminals(4)], 3, 3)).toBe(4);
  });
});

describe("centerZone", () => {
  it("первая группа, которая не зона", () => {
    expect(centerZone([files(1), directives(2), terminals(3)], 2, 3)).toBe(1);
    expect(centerZone([directives(1), files(2), terminals(3)], 1, 3)).toBe(2);
  });

  it("все группы — зоны: центра нет", () => {
    expect(centerZone([directives(1), terminals(2)], 1, 2)).toBeUndefined();
  });
});
