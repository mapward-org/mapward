import { expect, test } from "vitest";
import type { LogLine } from "@mapward/core";
import {
  filterKey,
  lineFields,
  lineLevel,
  lineMessage,
  lineSource,
  logFiles,
  logFilter,
} from "./logs.ts";

const line = (patch: Partial<LogLine>): LogLine => ({
  at: "2026-11-02T10:00:00.000Z",
  kind: "log",
  file: "shell",
  ...patch,
});

test("основной вид — строки объекта, с плагином или без; вся карта — без объекта", () => {
  const object = "mapward://a";
  expect(logFilter({ scope: "object", object, file: "" })).toEqual({ object });
  expect(logFilter({ scope: "object", object, file: "shell" })).toEqual({ object, file: "shell" });
  expect(logFilter({ scope: "map", object, file: "" })).toEqual({});
  expect(logFilter({ scope: "map", object, file: "agent" })).toEqual({ file: "agent" });
});

test("у прогона — строки его трейса, остальные фильтры не мешают", () => {
  expect(logFilter({ trace: "t1", scope: "map", object: "mapward://a", file: "shell" })).toEqual({
    trace: "t1",
  });
});

test("одинаковый фильтр — один ключ, сколько бы раз его ни собрали", () => {
  expect(filterKey({ object: "a", file: "b" })).toBe(filterKey({ file: "b", object: "a" }));
  expect(filterKey({ object: "a" })).not.toBe(filterKey({ file: "a" }));
});

test("файлы — из строк, по имени; выбранный не пропадает, даже без строк", () => {
  const lines = [line({ file: "shell" }), line({ file: "agent" }), line({ file: "shell" })];
  expect(logFiles(lines, "")).toEqual(["agent", "shell"]);
  expect(logFiles(lines, "views")).toEqual(["agent", "shell", "views"]);
  expect(logFiles([...lines, line({ file: "mapward" })], "mapward")).toEqual(["agent", "shell"]);
});

test("конец вызова читается статусом и временем; начало прогона — его именем", () => {
  const end = line({ kind: "call-end", method: "collect", status: "success", ms: 12 });
  expect(lineMessage(end)).toBe("прошёл · 12 мс");
  expect(lineMessage(line({ kind: "trace-start", label: "Релиз", target: "mapward://a" }))).toBe(
    "Релиз",
  );
});

test("уровень — словом в колонке: провал и остановка видны и у конца вызова", () => {
  expect(lineLevel(line({ kind: "error", text: "упал" }))).toEqual({
    label: "ERROR",
    tone: "fail",
  });
  expect(lineLevel(line({ kind: "call-end", status: "failure" })).tone).toBe("fail");
  expect(lineLevel(line({ kind: "call-end", status: "stopped" })).label).toBe("STOP");
  expect(lineLevel(line({ kind: "call-end", status: "success" })).label).toBe("DONE");
  expect(lineLevel(line({ kind: "log" })).label).toBe("INFO");
});

test("поля под строкой — ошибка первой, объект только на виде нескольких объектов", () => {
  const start = line({
    kind: "trace-start",
    object: "mapward://a",
    label: "Релиз",
    target: "mapward://a#release",
    inputs: { tag: "v1" },
    error: "нет доступа",
  });
  expect(lineFields(start, false).map(([key]) => key)).toEqual(["error", "target", "inputs"]);
  expect(lineFields(start, true).map(([key]) => key)).toContain("object");
  expect(lineFields(start, false)[2]).toEqual([
    "inputs",
    JSON.stringify({ tag: "v1" }, undefined, 2),
  ]);
});

test("сущность строки — подписями: плагин и метод, у платформы — инструмент или прогон", () => {
  expect(lineSource(line({ file: "shell", method: "json" }))).toEqual([
    ["плагин", "shell"],
    ["метод", "json"],
  ]);
  expect(lineSource(line({ file: "mapward", kind: "mcp", method: "read_index" }))).toEqual([
    ["инструмент mcp", "read_index"],
  ]);
  expect(lineSource(line({ file: "mapward", kind: "trace-start", traceKind: "action" }))).toEqual([
    ["прогон", "экшон"],
  ]);
});
