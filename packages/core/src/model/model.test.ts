import { expect, test } from "vitest";
import { adoptMetric, objectIndex } from "./model.ts";
import type { MapObject } from "./model.ts";

/**
 * Каждый наследник считает метрику прототипа своей. Пока адрес и кэш оставались прототипными,
 * все объекты делили одно значение, и карта показывала числа того, кого собрали последним.
 */
test("an inherited metric gets the heir's address and cache", () => {
  const adopted = adoptMetric(
    { address: "mapward://packages/core", path: "d:/map/packages/core" },
    {
      key: "requirements",
      address: "mapward://prototypes/system/_metrics/requirements",
      configPath: "d:/map/prototypes/system/_metrics/requirements/config.json",
      cachePath: "d:/map/prototypes/system/_metrics/requirements",
      layers: [
        {
          address: "mapward://prototypes/system/_metrics/requirements",
          path: "d:/map/prototypes/system/_metrics/requirements/config.json",
          from: "own",
        },
        {
          address: "mapward://shared-metrics/requirements",
          path: "d:/map/shared-metrics/requirements/config.json",
          from: "extends",
        },
      ],
      config: { label: "Требования" },
    },
  );

  expect(adopted.address).toBe("mapward://packages/core/_metrics/requirements");
  expect(adopted.cachePath).toBe("d:/map/packages/core/_metrics/requirements");
  // Конфиг остаётся прототипным: заимствуется определение, а не состояние.
  expect(adopted.configPath).toBe("d:/map/prototypes/system/_metrics/requirements/config.json");
  expect(adopted.config.label).toBe("Требования");
  // Своё у прототипа для наследника прототипово, а дальний слой каким был, таким и остался.
  expect(adopted.layers.map((layer) => layer.from)).toEqual(["prototype", "extends"]);
  expect(adopted.layers[0]?.path).toBe(
    "d:/map/prototypes/system/_metrics/requirements/config.json",
  );
});

const object = (fields: Partial<MapObject>): MapObject => ({
  address: "mapward://packages/core",
  path: "d:/map/packages/core",
  name: "core",
  isGroup: false,
  props: {},
  layers: [],
  metrics: [],
  directives: [],
  actions: [],
  workflow: [],
  children: [],
  ...fields,
});

/** Мердж объекта не хранится, а собирается: две копии `props` разъехались бы (решение 0019). */
test("the object merge is put back together from the model", () => {
  const index = objectIndex(
    object({
      prototypeName: "Пакет",
      props: { packageName: "@mapward/core" },
      prompt: "Читай карту через MCP",
      workflowMode: "replace",
      layers: [
        {
          address: "mapward://packages/core",
          path: "d:/map/packages/core/_index.json",
          from: "own",
        },
        {
          address: "mapward://prototypes/package",
          path: "d:/map/prototypes/package/_index.json",
          from: "prototype",
        },
      ],
    }),
  );

  expect(index.name).toBe("core");
  // `extends` берётся из слоёв: второй слой — это и есть прототип.
  expect(index.extends).toBe("mapward://prototypes/package");
  expect(index.props).toEqual({ packageName: "@mapward/core" });
  expect(index.prompt).toBe("Читай карту через MCP");
  expect(index["directives-workflow"]).toEqual({ mode: "replace" });
});

/** Пустое не пишется: `_index.json` из пустых полей читался бы хуже, чем из одного нужного. */
test("empty fields do not reach the merge", () => {
  const index = objectIndex(object({}));

  expect(index).toEqual({ name: "core" });
});
