import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import { objectPrompt, stagePrompt } from "./prompts.ts";

const object = {
  address: "mapward://packages/core",
  path: "/map/packages/core",
  name: "core",
  isGroup: false,
  props: {},
  metrics: [],
  directives: [],
  actions: [],
  workflow: [{ name: "Обсудить", order: 10, marksDone: false, path: "" }],
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

test("the object prompt names the stages and the call that runs them", () => {
  const prompt = objectPrompt(object, "/map");
  expect(prompt).toContain("«Обсудить»");
  expect(prompt).toContain("run_directive");
  expect(prompt).toContain("finish_directive");
});
