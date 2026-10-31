import { expect, test } from "vitest";
import { placeholder, toShape } from "./shape.ts";

test("вид, которого нет, — ошибка формы с его именем", () => {
  expect(toShape("component", {})).toEqual({ kind: "unknown", reason: "вид component" });
});

test("данные не той формы — так и говорится, а markdown — тот же { text }, что text", () => {
  expect(toShape("status", { nope: 1 })).toEqual({
    kind: "unknown",
    reason: "ждём { ok, summary }",
  });
  expect(toShape("markdown", { text: "**a**" })).toEqual({ kind: "markdown", text: "**a**" });
});

test("пусто — ответ, а не ошибка: своими словами метрики или «нет таких»", () => {
  expect(placeholder(toShape("list", undefined), undefined, undefined)).toBe("не собиралась");
  expect(placeholder(toShape("list", { items: [] }), { items: [] }, "пусто тут")).toBe("пусто тут");
  expect(placeholder(toShape("tree", { children: [] }), { children: [] }, undefined)).toBe(
    "нет таких",
  );
  expect(placeholder(toShape("text", { text: "x" }), { text: "x" }, undefined)).toBeUndefined();
});
