import { expect, test } from "vitest";
import { shapeHint } from "./shape.ts";

test("форма ответа — именем вида, схемой или никакая", () => {
  expect(shapeHint("status")).toContain('{ "ok": boolean, "summary"?: string }');
  expect(shapeHint({ type: "object", required: ["run"] })).toContain('"required":["run"]');
  expect(shapeHint("нет такого")).toBe("Ответь только json, без пояснений");
  expect(shapeHint()).toBe("Ответь только json, без пояснений");
});
