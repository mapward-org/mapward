import { expect, test } from "vitest";
import { rememberedArrow, rememberStyle, withRemembered } from "./remembered.ts";

test("the last style is remembered per kind and dresses the next shape of that kind", () => {
  let memory = rememberStyle({}, "rect", { color: "#ffd166", fontSize: 18 });
  memory = rememberStyle(memory, "line", { route: "rounded", stroke: "#219ebc" });
  expect(withRemembered({ id: "a", kind: "rect", x: 1, y: 2, text: "" }, memory)).toEqual({
    id: "a",
    kind: "rect",
    x: 1,
    y: 2,
    text: "",
    color: "#ffd166",
    fontSize: 18,
  });
  // Эллипс ничего не запоминал — остаётся как есть.
  expect(withRemembered({ id: "b", kind: "ellipse", x: 0, y: 0 }, memory)).toEqual({
    id: "b",
    kind: "ellipse",
    x: 0,
    y: 0,
  });
});

test("only style is remembered, and «no colour» forgets the field", () => {
  let memory = rememberStyle({}, "rect", { color: "#fff", x: 10, text: "не стиль" });
  expect(memory.rect).toEqual({ color: "#fff" });
  memory = rememberStyle(memory, "rect", { color: undefined });
  expect(memory.rect).toEqual({});
});

test("a new relation takes the remembered arrow style, or none", () => {
  expect(rememberedArrow({})).toBeUndefined();
  expect(rememberedArrow(rememberStyle({}, "arrow", { strokeWidth: 3 }))).toEqual({
    strokeWidth: 3,
  });
});
