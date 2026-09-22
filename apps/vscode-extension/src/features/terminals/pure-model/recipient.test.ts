import { expect, test } from "vitest";
import { chooseRecipient } from "./recipient.ts";

const session = (id: string, active = false) => ({ id, active });

test("the terminal that last ran this directive wins over the active one", () => {
  // Второй круг брейншторма идёт туда, где лежит тред, даже если активен соседний терминал.
  expect(chooseRecipient({ remembered: "t1", own: [session("t1"), session("t2", true)] })).toBe(
    "t1",
  );
});

test("a closed remembered terminal falls back to the active one", () => {
  expect(chooseRecipient({ remembered: "t9", own: [session("t1"), session("t2", true)] })).toBe(
    "t2",
  );
});

test("without an active terminal the first living one is taken", () => {
  expect(chooseRecipient({ own: [session("t1"), session("t2")] })).toBe("t1");
});

test("no terminal of the object means a new one", () => {
  expect(chooseRecipient({ remembered: "t1", own: [] })).toBeUndefined();
});
