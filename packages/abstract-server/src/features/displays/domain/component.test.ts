import { expect, test } from "vitest";
import { candidates, dataDeclaration, schemaErrors, schemaType } from "./component.ts";

test("тип по схеме: объект, обязательные поля, массив, enum, union", () => {
  expect(
    schemaType({
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["label"],
            properties: {
              label: { type: "string" },
              state: { enum: ["done", "todo"] },
              "file-path": { type: ["string", "null"] },
            },
          },
        },
        total: { type: "integer" },
      },
    }),
  ).toBe(
    [
      "{",
      "  items: Array<{",
      "    label: string;",
      '    state?: "done" | "todo";',
      '    "file-path"?: string | null;',
      "  }>;",
      "  total?: number;",
      "}",
    ].join("\n"),
  );
});

test("непонятное в схеме — unknown, а не выдумка", () => {
  expect(schemaType({ $ref: "#/defs/x" })).toBe("unknown");
  expect(schemaType({ type: "array", items: { type: "string" } })).toBe("string[]");
  expect(dataDeclaration({ type: "string" })).toContain("export type Data = string;");
});

test("ошибка схемы — путь до поля и что ожидалось", () => {
  const schema = {
    type: "object",
    properties: { items: { type: "array", items: { type: "string" } } },
  };
  expect(schemaErrors(schema, { items: ["a"] })).toEqual([]);
  expect(schemaErrors(schema, { items: [1] })).toEqual([expect.stringMatching(/^\/items\/0: /)]);
});

test("кандидаты в классы: arbitrary-значения и варианты целиком", () => {
  const found = candidates('<div className="p-2 hover:underline text-[var(--mw-foreground)]">');
  expect(found).toEqual(
    expect.arrayContaining(["p-2", "hover:underline", "text-[var(--mw-foreground)]"]),
  );
});

/** Решение 0038: экшон строки — своим именем в схеме, типом пакета в `display.data.d.ts`. */
test("mapward:action — тип ActionRef из пакета и проверка по форме экшона", () => {
  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, action: { $ref: "mapward:action" } },
        },
      },
    },
  };

  const declaration = dataDeclaration(schema);
  expect(declaration).toContain('import type { ActionRef } from "@mapward/display";');
  expect(declaration).toContain("action?: ActionRef;");
  expect(dataDeclaration({ type: "string" })).not.toContain("import");

  expect(schemaErrors(schema, { items: [{ action: { run: "rerun", inputs: { a: 1 } } }] })).toEqual(
    [],
  );
  expect(schemaErrors(schema, { items: [{ action: { inputs: {} } }] })).toEqual([
    expect.stringMatching(/^\/items\/0\/action/),
  ]);
});
