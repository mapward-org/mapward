import { expect, test } from "vitest";
import { foldersOf, letterOf, parsePorcelain, strongest } from "./git.ts";

test("две колонки порцелейна схлопываются в одну букву", () => {
  expect(letterOf(" M")).toBe("M");
  expect(letterOf("M ")).toBe("M");
  expect(letterOf("MM")).toBe("M");
  expect(letterOf("A ")).toBe("A");
  expect(letterOf(" D")).toBe("D");
  // Правка в индексе плюс пропажа в дереве: файла нет, и это заметнее правки.
  expect(letterOf("MD")).toBe("D");
  // Переименование — файл, которого в старом дереве не было.
  expect(letterOf("R ")).toBe("A");
  expect(letterOf("RM")).toBe("A");
});

test("неслитое состояние — конфликт, чем бы оно ни было записано", () => {
  expect(letterOf("UU")).toBe("C");
  expect(letterOf("AU")).toBe("C");
  expect(letterOf("UD")).toBe("C");
  expect(letterOf("AA")).toBe("C");
  expect(letterOf("DD")).toBe("C");
});

test("неотслеживаемое и игнорируемое различаются", () => {
  expect(letterOf("??")).toBe("U");
  // `!!` приходит только с `--ignored`, и своей буквы у него нет.
  expect(letterOf("!!")).toBeUndefined();
  expect(letterOf("  ")).toBeUndefined();
});

test("записи разделены нулём, кириллица приходит как есть", () => {
  const marks = parsePorcelain(
    " M packages/core/src/model/display.ts\0?? ru/карта/новая заметка.md\0",
  );

  expect(marks.get("packages/core/src/model/display.ts")).toBe("M");
  // С `-z` путь не кавычится и не экранируется: русское имя читается напрямую.
  expect(marks.get("ru/карта/новая заметка.md")).toBe("U");
  expect(marks.size).toBe(2);
});

test("переименование занимает две записи, старый путь в ответ не идёт", () => {
  const marks = parsePorcelain("R  src/new.ts\0src/old.ts\0 M src/other.ts\0");

  expect(marks.get("src/new.ts")).toBe("A");
  expect(marks.has("src/old.ts")).toBe(false);
  // Старый путь съеден как часть записи о переименовании, а не принят за следующий статус.
  expect(marks.get("src/other.ts")).toBe("M");
});

test("пометки папок считаются по файлам внутри", () => {
  const marks = parsePorcelain(" M src/a.ts\0?? src/nested/b.ts\0 D other/c.ts\0");
  const folders = foldersOf(marks);

  // Пропажа заметнее правки, правка заметнее неотслеживаемого.
  expect(strongest(folders.get("src") ?? [])).toBe("M");
  expect(strongest(folders.get("src/nested") ?? [])).toBe("U");
  expect(strongest(folders.get("other") ?? [])).toBe("D");
  // Папок, в которых ничего не изменилось, в справочнике нет вовсе.
  expect(folders.has("docs")).toBe(false);
});
