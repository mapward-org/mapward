import { expect, test } from "vitest";
import { anchorDisplay, anchorGroups } from "./anchor-display.ts";

test("абсолютный путь и путь с подстановки в начале не привязываются к папке", () => {
  const config = anchorDisplay(
    {
      component: "/abs/view.tsx",
      agent: { plugin: "${{ mapward:// }}/_plugins/files", method: "tree" },
    },
    "/map/_metrics/tx/config.json",
  );
  expect(config.component).toBe("/abs/view.tsx");
  // Подстановка случится позже, на собранном конфиге: тогда путь и станет абсолютным.
  expect(config.agent?.plugin).toBe("${{ mapward:// }}/_plugins/files");
});

test("метрика-компонент: компонент и плагин запроса для агента — от того же config.json", () => {
  const config = anchorDisplay(
    {
      component: "./view.tsx",
      params: { path: "packages/core" },
      agent: { plugin: "../../_plugins/files", method: "summary" },
    },
    "D:/map/_metrics/files/config.json",
  );
  expect(config.component).toBe("D:/map/_metrics/files/view.tsx");
  expect(config.agent).toEqual({ plugin: "D:/map/_plugins/files", method: "summary" });
  expect(config.params).toEqual({ path: "packages/core" });
});

test("раскладка группы — от папки того _index.json, где группа написана", () => {
  const [own, absolute, address, plain] = anchorGroups(
    [
      { key: "всё", metrics: ["code"], layout: "./layout.tsx" },
      { key: "абс", metrics: [], layout: "D:\\shared\\layout.tsx" },
      { key: "адрес", metrics: [], layout: "mapward://prototypes/package/layout.tsx" },
      { key: "список", metrics: ["code"] },
    ],
    "D:/map/prototypes/package",
  );
  expect(own?.layout).toBe("D:/map/prototypes/package/layout.tsx");
  expect(absolute?.layout).toBe("D:/shared/layout.tsx");
  // Адрес остаётся адресом: папку карты знает тот, кто будет собирать.
  expect(address?.layout).toBe("mapward://prototypes/package/layout.tsx");
  expect(plain).toEqual({ key: "список", metrics: ["code"] });
});
