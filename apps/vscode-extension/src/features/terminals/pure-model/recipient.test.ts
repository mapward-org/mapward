import { expect, test } from "vitest";
import { chooseRecipient } from "./recipient.ts";

const session = (id: string, directive?: string, active = false) => ({
  id,
  active,
  ...(directive === undefined ? {} : { directive }),
});

test("a directive goes to its own terminal even when another one is active", () => {
  expect(
    chooseRecipient({
      directive: "a.md",
      own: [session("t1", "a.md"), session("t2", undefined, true)],
    }),
  ).toBe("t1");
});

/** Решение 0032: в чужой терминал фраза не уходит — ни в свободный, ни в терминал другой директивы. */
test("a directive without its own terminal gets a new one", () => {
  expect(
    chooseRecipient({
      directive: "a.md",
      own: [session("t1", "b.md", true), session("t2", undefined, true)],
    }),
  ).toBeUndefined();
});

test("the object button takes the active free terminal", () => {
  expect(
    chooseRecipient({
      own: [session("t1"), session("t2", undefined, true), session("t3", "a.md")],
    }),
  ).toBe("t2");
});

test("the object button never takes a directive terminal", () => {
  expect(chooseRecipient({ own: [session("t1", "a.md", true)] })).toBeUndefined();
});

test("without an active free terminal the first free one is taken", () => {
  expect(chooseRecipient({ own: [session("t1", "a.md"), session("t2"), session("t3")] })).toBe(
    "t2",
  );
});
