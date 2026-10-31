import { expect, test } from "vitest";
import { schemaErrors } from "./schema-errors.ts";

test("ошибка схемы — путь до поля и что ожидалось", () => {
  const schema = {
    type: "object",
    properties: { items: { type: "array", items: { type: "string" } } },
  };
  expect(schemaErrors(schema, { items: ["a"] })).toEqual([]);
  expect(schemaErrors(schema, { items: [1] })).toEqual([expect.stringMatching(/^\/items\/0: /)]);
});
