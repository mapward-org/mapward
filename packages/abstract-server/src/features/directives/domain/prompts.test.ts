import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import { directivePrompt, objectPrompt, stagePrompt, stageRequest } from "./prompts.ts";

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

const forDirective = (warmUp: boolean) =>
  directivePrompt({
    object: { ...object, prompt: "память карты — /repo/ru/memories/" },
    mapPath: "/map",
    directive: "2026-11-01-0900-проба.md",
    directivePath: "/map/packages/core/_directives/2026-11-01-0900-проба.md",
    warmUp,
  });

/**
 * Агент директивы с первой строки знает, чья он: вызов этапа показан с адресом объекта и именем
 * директивы, остаётся назвать этап. Голова про MCP и правила объекта — те же, что везде.
 */
test("the directive prompt names its directive and the exact call", () => {
  const prompt = forDirective(false);
  expect(prompt).toContain("Ты агент директивы 2026-11-01-0900-проба.md");
  expect(prompt).toContain(
    'run_directive { address: "mapward://packages/core", directive: "2026-11-01-0900-проба.md"',
  );
  expect(prompt).toContain('read_docs { section: "mcp" }');
  expect(prompt).toContain("/repo/ru/memories/");
  expect(prompt).toContain("«Обсудить»");
});

/**
 * Разогрев — только для нового разговора без этапа: карта и директива, без кода, и «готов».
 * Разговору, который заводит кнопка этапа, он не нужен — фраза этапа едет следом.
 */
test("only a conversation opened without a stage warms up", () => {
  const warm = forDirective(true);
  expect(warm).toContain("--- Разогрев ---");
  expect(warm).toContain(
    'read_index { address: "mapward://packages/core", file: "2026-11-01-0900-проба.md" }',
  );
  expect(warm).toContain("Код не читай");
  expect(warm).toContain("«готов»");
  expect(forDirective(false)).not.toContain("--- Разогрев ---");
});

/** Этап, пришедший в разогретый разговор, не перечитывает то, что уже прочитано. */
test("every prompt tells the agent not to reread what it already has", () => {
  const forStage = stagePrompt({
    stage: object.workflow[0]!,
    text: "скажи, что думаешь",
    directivePath: "/map/_directives/проба.md",
    object,
    mapPath: "/map",
  });
  for (const prompt of [objectPrompt(object, "/map"), forStage, forDirective(true)]) {
    expect(prompt).toContain("повторно не читай");
  }
});
