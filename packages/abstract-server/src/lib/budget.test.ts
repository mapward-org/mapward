import { expect, test } from "vitest";
import { fit } from "./budget.ts";

const answerOf = () => ({
  address: "mapward://",
  metrics: [
    { key: "requirements", config: { label: "Требования" }, value: { data: "х".repeat(400) } },
    { key: "version", config: { label: "Версия" }, value: { data: "0.0.0" } },
  ],
  children: [
    {
      address: "mapward://packages",
      metrics: [{ key: "files", value: { data: "у".repeat(200) } }],
    },
  ],
});

test("what fits comes through untouched", () => {
  const answer = answerOf();
  expect(fit(answer, 100_000)).toEqual(answerOf());
  expect(fit(answerOf(), 0)).toEqual(answerOf());
});

test("the heaviest value goes first, and says how much it weighed", () => {
  const answer = fit(answerOf(), 400);

  const cut = answer.metrics[0]?.value as unknown as { truncated: boolean; bytes: number };
  expect(cut.truncated).toBe(true);
  expect(cut.bytes).toBeGreaterThan(400);
  // Лёгкое осталось: режут ровно столько, сколько нужно, чтобы влезть.
  expect(answer.metrics[1]?.value).toEqual({ data: "0.0.0" });
});

test("children are cut too — they ride in the same answer", () => {
  const answer = fit(answerOf(), 120);
  expect(answer.children[0]?.metrics[0]?.value).toMatchObject({ truncated: true });
});
