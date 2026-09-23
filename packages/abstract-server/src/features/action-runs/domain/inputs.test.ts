import { expect, test } from "vitest";
import { checkInputs, fillInputs, inputEnv } from "./inputs.ts";

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

test("form values reach a prompt through ${{ inputs.name }} and a script through the env", () => {
  expect(fillInputs("выпусти ${{ inputs.level }} и ${{ inputs.nope }}", { level: "minor" })).toBe(
    "выпусти minor и ${{ inputs.nope }}",
  );
  expect(inputEnv({ "dry-run": true })).toEqual({
    MAPWARD_INPUTS: '{"dry-run":true}',
    MAPWARD_INPUT_DRY_RUN: "true",
  });
});
