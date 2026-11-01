import { describe, expect, it } from "vitest";
import {
  centerZone,
  directiveZone,
  isDirectivePath,
  layoutPlan,
  newDirectiveColumn,
  terminalZone,
} from "./zones.ts";

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
  it("группа из одних директив — зона, в какой бы колонке ни стояла", () => {
    expect(directiveZone([files(1), directives(2), terminals(3)])).toBe(2);
    expect(directiveZone([directives(1), files(2), terminals(3)])).toBe(1);
    expect(directiveZone([directives(1)])).toBe(1);
  });

  it("директива вперемешку с другими файлами — гостья, зоны нет", () => {
    expect(directiveZone([group(1, { directives: true, others: true }), files(2)])).toBeUndefined();
  });

  it("узнаётся по содержимому, а не по запомненному номеру: центр разрезали — номера съехали", () => {
    expect(directiveZone([files(1), files(2), directives(3), terminals(4)], 2)).toBe(3);
  });

  it("из двух подходящих — запомненная", () => {
    expect(directiveZone([files(1), directives(2), directives(3)], 2)).toBe(2);
  });
});

describe("terminalZone", () => {
  it("группа из одних терминалов", () => {
    expect(terminalZone([files(1), directives(2), terminals(3)])).toBe(3);
    expect(
      terminalZone([group(1, { terminals: true, others: true }), directives(2)]),
    ).toBeUndefined();
  });

  it("узнаётся по содержимому, а не по запомненному номеру", () => {
    expect(terminalZone([files(1), files(2), directives(3), terminals(4)], 3)).toBe(4);
  });
});

describe("newDirectiveColumn", () => {
  it("справа от всего открытого", () => {
    expect(newDirectiveColumn([files(1)])).toBe(2);
    expect(newDirectiveColumn([files(1), files(2)])).toBe(3);
  });

  it("ничего не открыто — всё равно справа: пустая группа остаётся центром", () => {
    expect(newDirectiveColumn([group(1)])).toBe(2);
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

describe("layoutPlan", () => {
  it("зон нет — раскладывать нечего", () => {
    expect(layoutPlan([files(1), files(2)], undefined, undefined)).toEqual({ kind: "none" });
  });

  it("остались только директивы и терминалы — завести центр", () => {
    expect(layoutPlan([directives(1), terminals(2)], 1, 2)).toEqual({ kind: "make-center" });
  });

  it("центр, директивы, терминалы по порядку — разложить", () => {
    expect(layoutPlan([files(1), directives(2), terminals(3)], 2, 3)).toEqual({
      kind: "arrange",
      right: 2,
    });
    expect(layoutPlan([group(1), directives(2)], 2, undefined)).toEqual({
      kind: "arrange",
      right: 1,
    });
  });

  it("лишние группы или чужой порядок — не раскладывается", () => {
    expect(layoutPlan([files(1), files(2), directives(3), terminals(4)], 3, 4)).toEqual({
      kind: "extra",
      count: 1,
    });
    expect(layoutPlan([files(1), terminals(2), directives(3)], 3, 2)).toEqual({
      kind: "extra",
      count: 0,
    });
  });
});
