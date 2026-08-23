import { expect, test } from "vitest";
import { VERSION } from "./index.ts";

// A smoke test, on purpose: it proves the runner, the paths and the package boundary are wired up
// before there is anything to actually test.
test("core exposes its version", () => {
  expect(VERSION).toBe("0.0.0");
});
