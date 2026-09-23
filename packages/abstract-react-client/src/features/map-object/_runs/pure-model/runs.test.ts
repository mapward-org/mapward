import { expect, test } from "vitest";
import type { Run } from "@mapward/core";
import { duration, lastRun, pickRun, runningCount, startedLabel } from "./runs.ts";

const run = (id: string, target: string, status: Run["status"] = "success"): Run => ({
  id,
  kind: "metric",
  target,
  object: "mapward://a",
  label: target,
  source: "ui",
  status,
  startedAt: "2026-09-23T10:00:00.000Z",
  steps: [],
});

// Свежие сверху — так их отдаёт сервер.
const runs = [
  run("3", "mapward://a/_metrics/files", "failure"),
  run("2", "mapward://a/_actions/release", "running"),
  run("1", "mapward://a/_actions/release", "running"),
  run("0", "mapward://a/_metrics/files"),
];

test("красная точка ведёт на последний прогон своей метрики", () => {
  expect(lastRun(runs, "mapward://a/_metrics/files")?.id).toBe("3");
  expect(lastRun(runs, "mapward://a/_metrics/none")).toBeUndefined();
});

test("идущие прогоны одного экшона считаются все: они параллельны", () => {
  expect(runningCount(runs, "mapward://a/_actions/release")).toBe(2);
  expect(runningCount(runs, "mapward://a/_metrics/files")).toBe(0);
});

test("открыт названный прогон, а пропавший или не названный — самый свежий", () => {
  expect(pickRun(runs, "1")?.id).toBe("1");
  expect(pickRun(runs, "gone")?.id).toBe("3");
  expect(pickRun(runs, undefined)?.id).toBe("3");
  expect(pickRun([], undefined)).toBeUndefined();
});

test("длительность идущего — до сейчас, законченного — до конца", () => {
  const from = "2026-09-23T10:00:00.000Z";
  expect(duration(from, "2026-09-23T10:00:07.000Z", 0)).toBe("7 с");
  expect(duration(from, undefined, Date.parse("2026-09-23T10:01:05.000Z"))).toBe("1 мин 5 с");
});

test("сегодняшний прогон — временем, прежний — с датой", () => {
  const at = new Date(2026, 8, 23, 9, 5).toISOString();
  expect(startedLabel(at, new Date(2026, 8, 23, 18, 0).getTime())).toBe("09:05");
  expect(startedLabel(at, new Date(2026, 8, 25, 18, 0).getTime())).toBe("23.09 09:05");
});
