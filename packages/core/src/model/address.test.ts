import { expect, test } from "vitest";
import { linkKind, mountedAddress, parseAddress, splitMount } from "./address.ts";

/**
 * Имя подключённой карты стоит перед двоеточием, а остаток — адрес внутри неё, по её правилам:
 * своё `@` у неё и корень свой.
 */
test("an address names a mounted map before the colon", () => {
  expect(parseAddress("mapward://leafer:/arch#props.name")).toEqual({
    scope: "map",
    path: ["arch"],
    field: ["props", "name"],
    mount: "leafer",
  });
  expect(parseAddress("mapward://leafer:@/src")).toEqual({
    scope: "base",
    path: ["src"],
    mount: "leafer",
  });
  expect(parseAddress("mapward://leafer:")).toEqual({ scope: "map", path: [], mount: "leafer" });
  expect(parseAddress("mapward://leafer:#props.name")?.field).toEqual(["props", "name"]);
  expect(parseAddress("mapward://packages/core")?.mount).toBeUndefined();
});

test("a mounted address cannot point at this object or chain mounts", () => {
  expect(parseAddress("mapward://leafer:~")).toBeUndefined();
  expect(parseAddress("mapward://leafer:/ed:/core")).toBeUndefined();
});

test("a mounted address splits into the map and the address inside it, and back", () => {
  expect(splitMount("mapward://leafer:/arch/x")).toEqual({
    mount: "leafer",
    local: "mapward://arch/x",
  });
  expect(splitMount("mapward://arch")).toBeUndefined();
  for (const raw of ["mapward://leafer:/arch/x", "mapward://leafer:", "mapward://leafer:@/src"]) {
    const split = splitMount(raw);
    expect(split && mountedAddress(split.mount, split.local)).toBe(raw);
  }
});

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
