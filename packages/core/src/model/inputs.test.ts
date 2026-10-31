import { expect, test } from "vitest";
import { actionArgs, actionForm, checkInputs, confirmQuestion, fillInputs } from "./inputs.ts";

const declared = {
  level: { type: "choice" as const, options: ["patch", "minor"], default: "patch" },
  count: { type: "number" as const, required: true },
  dry: { type: "boolean" as const },
  note: {},
};

test("strings from a terminal become the kind of the field", () => {
  const { values, errors } = checkInputs(declared, { count: "3", dry: "true" });

  expect(errors).toEqual({});
  expect(values).toEqual({ level: "patch", count: 3, dry: true });
});

test("a missing required field, a wrong choice and an unknown name are all errors", () => {
  const { errors } = checkInputs(declared, { level: "major", typo: "x" });

  expect(Object.keys(errors).toSorted()).toEqual(["count", "level", "typo"]);
});

test("an unchecked flag is false, not missing", () => {
  expect(checkInputs(declared, { count: 1 }).values.dry).toBe(false);
});

test("form values reach a text through ${{ inputs.name }}", () => {
  expect(fillInputs("выпусти ${{ inputs.level }} и ${{ inputs.nope }}", { level: "minor" })).toBe(
    "выпусти minor и ${{ inputs.nope }}",
  );
});

/** Схема параметров метода, как её отдаёт самоописание плагина. */
const schema = {
  type: "object",
  required: ["repo", "name", "level"],
  properties: {
    repo: { type: "string" },
    name: { type: "string", description: "метка" },
    level: { enum: ["patch", "minor"], default: "patch" },
    count: { type: "integer" },
    force: { type: "boolean" },
    notes: { type: "string", format: "multiline" },
    env: { type: "object" },
    permissions: { anyOf: [{ const: "bypass" }, { type: "array" }] },
  },
};

test("the form of an action over a method is its schema minus the given params", () => {
  const config = { plugin: "/p", method: "tag", params: { repo: "core" } };

  expect(actionForm(config, schema)).toEqual({
    name: { type: "string", description: "метка", required: true },
    level: { type: "choice", options: ["patch", "minor"], default: "patch", required: true },
    count: { type: "number" },
    force: { type: "boolean" },
    notes: { type: "string", multiline: true },
  });
  // Данные формы ложатся рядом с заданными параметрами.
  expect(actionArgs(config, { name: "v1" })).toEqual({ repo: "core", name: "v1" });
});

test("written inputs win over the schema, and their values come as one field", () => {
  const config = { plugin: "/p", method: "run", params: { command: "x" }, inputs: { path: {} } };

  expect(actionForm(config, schema)).toEqual({ path: {} });
  expect(actionArgs(config, { path: "a" })).toEqual({ command: "x", inputs: { path: "a" } });
});

test("the question before a run is filled from the form it was asked with", () => {
  const config = { confirm: "Метка ${{ inputs.name }}?" };
  expect(confirmQuestion(config, { name: "v1" }, { name: {} })).toBe("Метка v1?");
});
