import { expect, test } from "vitest";
import { linkKind } from "./address.ts";

/**
 * Решение 0005: куда ведёт ссылка, решает её схема. Путь с буквой диска — это файл, а не
 * схема `d:`, иначе на windows каждая ссылка на файл уезжала бы в браузер.
 */
test("a link goes where its scheme promises", () => {
  expect(linkKind("mapward://packages/core")).toBe("object");
  expect(linkKind("https://example.com")).toBe("external");
  expect(linkKind("mailto:someone@example.com")).toBe("external");
  expect(linkKind("d:/repo/apps/cli/src/cli.ts")).toBe("file");
  expect(linkKind("/repo/readme.md")).toBe("file");
  expect(linkKind("ru/docs/mapward/metrics.md")).toBe("file");
});
