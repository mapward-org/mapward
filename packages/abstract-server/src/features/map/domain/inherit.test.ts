import { expect, test } from "vitest";
import { adoptMetric } from "./inherit.ts";

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
