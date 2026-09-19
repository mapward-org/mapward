import { expect, test } from "vitest";
import { join, normalize, relative } from "./path.ts";

/**
 * Пути внутри сервера — строки: `node:path` пакету взять неоткуда. Значит схлопывать `.` и
 * `..` приходится самим, иначе `@` с дефолтным `baseUrl` доезжает до ссылки как `repo/./apps`.
 */
test("join collapses dot segments", () => {
  expect(join("d:/repo/.", "apps/cli")).toBe("d:/repo/apps/cli");
  expect(join("d:/repo/map", "..", "docs")).toBe("d:/repo/docs");
  expect(normalize("d:/repo//map/")).toBe("d:/repo/map");
});

test("join keeps backslashes out", () => {
  expect(join("d:\\repo", "ru\\map")).toBe("d:/repo/ru/map");
});

test("relative gives the path from the map root", () => {
  expect(relative("d:/repo/ru/map", "d:/repo/ru/map/apps/cli")).toBe("apps/cli");
});
