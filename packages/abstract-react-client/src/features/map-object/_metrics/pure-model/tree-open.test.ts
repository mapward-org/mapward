import { expect, test } from "vitest";
import { DEFAULT_TREE, folderPath, isFolderOpen, toggleFolder, treeOpen } from "./tree-open.ts";

test("путь папки — цепочка имён от корня, без номера строки", () => {
  const src = folderPath("", "src", 3);
  expect(folderPath(src, "ui", 0)).toBe("src/ui");
  // Та же папка на другом месте списка — тот же путь.
  expect(folderPath(folderPath("", "src", 0), "ui", 7)).toBe("src/ui");
  expect(folderPath("", undefined, 2)).toBe("#2");
});

test("переключение открывает и закрывает папку", () => {
  const open = toggleFolder({}, DEFAULT_TREE, "src");
  expect(isFolderOpen(open, DEFAULT_TREE, "src")).toBe(true);
  expect(isFolderOpen(toggleFolder(open, DEFAULT_TREE, "src"), DEFAULT_TREE, "src")).toBe(false);
});

test("деревья с разными id не задевают друг друга", () => {
  const state = toggleFolder({}, "left", "src");
  expect(isFolderOpen(state, "left", "src")).toBe(true);
  expect(isFolderOpen(state, "right", "src")).toBe(false);
  expect(isFolderOpen(state, DEFAULT_TREE, "src")).toBe(false);
});

test("раскрытие дерева сохраняет состояние всей метрики", () => {
  let saved = { left: ["a"] };
  treeOpen(saved, true, DEFAULT_TREE, (next) => {
    saved = next as typeof saved;
  }).toggle("src");
  expect(saved).toEqual({ left: ["a"], [DEFAULT_TREE]: ["src"] });
});
