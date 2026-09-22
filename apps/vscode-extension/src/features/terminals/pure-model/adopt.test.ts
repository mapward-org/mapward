import { expect, test } from "vitest";
import { adopt } from "./adopt.ts";

test("terminals are recognised by their tab name", () => {
  const owners = {
    "mapward: core": { address: "mapward://packages/core" },
    "core · buttons · План": {
      address: "mapward://packages/core",
      directive: "2026-09-22-buttons.md",
    },
  };

  expect(adopt(["bash", "core · buttons · План", "mapward: core"], owners)).toEqual([
    { index: 1, owner: owners["core · buttons · План"] },
    { index: 2, owner: owners["mapward: core"] },
  ]);
});

test("a tab outside the record stays someone else's", () => {
  expect(adopt(["mapward: core"], {})).toEqual([]);
  // Имя, совпавшее со свойством объекта, — всё равно чужая вкладка.
  expect(adopt(["constructor"], {})).toEqual([]);
});
