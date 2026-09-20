import { expect, test } from "vitest";
import { freeName } from "./names.ts";

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
