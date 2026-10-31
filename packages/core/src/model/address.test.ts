import { expect, test } from "vitest";
import { linkKind } from "./address.ts";
import { memberOwner } from "./folders.ts";

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

test("владелец метрики и экшона — объект, у которого лежит их папка", () => {
  expect(memberOwner("mapward://apps/web/_metrics/size")).toBe("mapward://apps/web");
  expect(memberOwner("mapward://_actions/release")).toBe("mapward://");
  expect(memberOwner("mapward://apps/web")).toBeUndefined();
  expect(memberOwner("mapward://apps/_directives/x")).toBeUndefined();
});
