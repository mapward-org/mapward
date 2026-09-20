import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import { objectPrompt, stagePrompt, stageRequest } from "./prompts.ts";

const object = {
  address: "mapward://packages/core",
  path: "/map/packages/core",
  name: "core",
  isGroup: false,
  props: {},
  layers: [],
  metrics: [],
  directives: [],
  actions: [],
  workflow: [{ name: "Обсудить", order: 10, marksDone: false, path: "" }],
  metricGroups: [],
  children: [],
} as MapObject;

/**
 * Промпт — весь интерфейс к агенту, и обе точки входа должны говорить про MCP одинаково.
 * Терминал объекта без этого уходит обходить репозиторий — решение 0016.
 */
test("both prompts send the agent to the docs first", () => {
  const forObject = objectPrompt(object, "/map");
  const forStage = stagePrompt({
    stage: object.workflow[0]!,
    text: "скажи, что думаешь",
    directivePath: "/map/_directives/проба.md",
    object,
    mapPath: "/map",
  });

  for (const prompt of [forObject, forStage]) {
    expect(prompt).toContain('read_docs { section: "mcp" }');
    expect(prompt).toContain('read_docs { section: "directives" }');
    expect(prompt).toContain("не обходом репозитория");
  }
});

/**
 * Решение 0018: одно поле работает в обоих каналах. Терминал и прогон — один и тот же агент на
 * одном и том же объекте, и правило объекта не зависит от того, запущена директива или нет.
 */
test("the object prompt reaches both the terminal and the stage", () => {
  const withPrompt = { ...object, prompt: "память карты — /repo/ru/memories/" };

  const forObject = objectPrompt(withPrompt, "/map");
  const forStage = stagePrompt({
    stage: withPrompt.workflow[0]!,
    text: "скажи, что думаешь",
    hook: "и напиши отзыв",
    directivePath: "/map/_directives/проба.md",
    object: withPrompt,
    mapPath: "/map",
  });

  for (const prompt of [forObject, forStage]) expect(prompt).toContain("/repo/ru/memories/");
  // Правила объекта стоят до этапа: они не довесок к нему, в отличие от хука прогонов.
  expect(forStage.indexOf("/repo/ru/memories/")).toBeLessThan(forStage.indexOf("--- Этап ---"));
  expect(forStage.indexOf("и напиши отзыв")).toBeGreaterThan(forStage.indexOf("--- Этап ---"));
});

/** Поля нет — нет и блока: пустой заголовок рассказывал бы агенту о несуществующем правиле. */
test("an object without a prompt of its own gets no block", () => {
  expect(objectPrompt(object, "/map")).not.toContain("--- От карты ---");
});

test("the object prompt names the stages and the call that runs them", () => {
  const prompt = objectPrompt(object, "/map");
  expect(prompt).toContain("«Обсудить»");
  expect(prompt).toContain("run_directive");
  expect(prompt).toContain("finish_directive");
});

/**
 * Кнопка шлёт фразу, а не промпт: содержательного в ней нет, и агент по ней идёт за промптом
 * этапа в MCP — решение 0017. Поэтому во фразе должно быть ровно то, что нужно вызову:
 * объект, директива, этап.
 */
test("the button phrase carries the call, not the instructions", () => {
  const text = stageRequest({
    object,
    directive: "2026-09-19-2335-add-directives-hooks.md",
    stage: "Проверка",
  });

  expect(text).toContain("2026-09-19-2335-add-directives-hooks.md");
  expect(text).toContain("Проверка");
  expect(text).toContain(object.address);
  // Промпта во фразе нет: за ним агент идёт сам, иначе контракт живёт в двух местах.
  expect(text).not.toContain("read_docs");
  expect(text.split("\n")).toHaveLength(1);
});
