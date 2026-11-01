import { expect, test } from "vitest";
import { changedSpan } from "./changed-span.ts";

const apply = (before: string, after: string) => {
  const span = changedSpan(before, after);
  return span ? before.slice(0, span.start) + span.text + before.slice(span.end) : before;
};

test("a new status in the frontmatter replaces only the status, not the body", () => {
  const before = "---\nstatus: waiting\n---\nbody\n";
  const after = "---\nstatus: running\n---\nbody\n";
  const span = changedSpan(before, after);
  expect(span).toEqual({ start: 12, end: 16, text: "runn" });
  expect(apply(before, after)).toBe(after);
});

test("a reply appended at the end is an insertion at the end", () => {
  const before = "text\n";
  const after = "text\n\n> [AI] reply\n";
  expect(changedSpan(before, after)).toEqual({ start: 5, end: 5, text: "\n> [AI] reply\n" });
});

test("the same text needs no edit", () => {
  expect(changedSpan("same", "same")).toBeUndefined();
});

test("repeated characters at the seam do not make the span overlap itself", () => {
  for (const [before, after] of [
    ["aaa", "aaaa"],
    ["aaaa", "aa"],
    ["abcabc", "abc"],
    ["", "x"],
    ["x", ""],
  ] as const) {
    expect(apply(before, after)).toBe(after);
  }
});

test("a surrogate pair is never split by the span", () => {
  const before = "a😀b";
  const after = "a😁b";
  const span = changedSpan(before, after);
  expect(span).toEqual({ start: 1, end: 3, text: "😁" });
  expect(apply(before, after)).toBe(after);
});
