import { expect, test } from "vitest";
import { freeName, shortDirective, stageName } from "./names.ts";

const taken =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name);

test("the first terminal of an object keeps the plain name", () => {
  expect(freeName("mapward: core", taken())).toBe("mapward: core");
});

test("a second terminal gets a number instead of restarting the first", () => {
  expect(freeName("mapward: core", taken("mapward: core"))).toBe("mapward: core 2");
  expect(freeName("mapward: core", taken("mapward: core", "mapward: core 2"))).toBe(
    "mapward: core 3",
  );
});

test("a closed terminal frees its number", () => {
  // Второй закрыли — третий открывать незачем, имя снова свободно.
  expect(freeName("mapward: core", taken("mapward: core", "mapward: core 3"))).toBe(
    "mapward: core 2",
  );
});

test("objects do not share numbering", () => {
  expect(freeName("mapward: docs", taken("mapward: core", "mapward: core 2"))).toBe(
    "mapward: docs",
  );
});

/**
 * Вкладка узкая, а имя директивы приезжает файлом — с датой, временем и расширением. В имя
 * идёт только суть, иначе вкладка занимает пол-экрана (решение 0017).
 */
test("the tab name keeps the point of the directive, not its file name", () => {
  expect(shortDirective("2026-09-19-2335-add-directives-hooks.md")).toBe("add-directives-hooks");
  // Имя без даты не трогаем: резать нечего, а терять — есть что.
  expect(shortDirective("верни-кнопки.md")).toBe("верни-кнопки");
});

test("a finished stage is marked, not erased", () => {
  const running = stageName({
    base: "Mapward (ru)",
    directive: "2026-09-19-2335-add-directives-hooks.md",
    stage: "Тестирование",
  });
  expect(running).toBe("Mapward (ru) · add-directives-hooks · Тестирование");
  expect(
    stageName({
      base: "Mapward (ru)",
      directive: "2026-09-19-2335-add-directives-hooks.md",
      stage: "Тестирование",
      done: true,
    }),
  ).toBe(`${running} ✓`);
});
