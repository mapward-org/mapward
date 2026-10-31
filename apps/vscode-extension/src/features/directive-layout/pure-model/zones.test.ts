import { describe, expect, it } from "vitest";
import { directiveZone, isDirectivePath, terminalZone } from "./zones.ts";

const group = (column: number, directives = false, terminals = false) => ({
  column,
  directives,
  terminals,
});

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
    expect(directiveZone([group(1, true)])).toBeUndefined();
  });

  it("берёт правую группу с директивами", () => {
    expect(directiveZone([group(1), group(2, true), group(3, false, true)])).toBe(2);
  });

  it("запомненная группа держится, пока она есть", () => {
    expect(directiveZone([group(1), group(2), group(3)], 2)).toBe(2);
    expect(directiveZone([group(1), group(2, true)], 4)).toBe(2);
  });
});

describe("terminalZone", () => {
  it("не центр и не группа директив", () => {
    const terminals = (column: number) => group(column, false, true);
    expect(terminalZone([terminals(1), terminals(2), terminals(3)], 2)).toBe(3);
    expect(terminalZone([terminals(1), terminals(2)], 2)).toBeUndefined();
  });
});
