import { expect, test } from "vitest";
import { adoptMetric, groupMetrics, objectIndex, pickGroup, previewGroup } from "./model.ts";
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
  metricGroups: [],
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

/** Метрика ищется по ключу — в тестах групп важен только он. */
const metric = (key: string) => ({
  key,
  address: `mapward://packages/core/_metrics/${key}`,
  configPath: `d:/map/packages/core/_metrics/${key}/config.json`,
  cachePath: `d:/map/packages/core/_metrics/${key}`,
  layers: [],
  config: {},
});

const withGroups = () =>
  object({
    metrics: [metric("files"), metric("architecture"), metric("drift")],
    metricGroups: [
      { key: "код", metrics: ["architecture", "files"] },
      { key: "тяжёлое", metrics: ["drift"] },
    ],
  });

/** Решение 0025: вкладка всегда одна — от неё зависит, что вообще собирается. */
test("the open group falls back to the first one", () => {
  const core = withGroups();

  expect(pickGroup(core, "тяжёлое")?.key).toBe("тяжёлое");
  expect(pickGroup(core, undefined)?.key).toBe("код");
  // Ключа такого нет — вкладка всё равно открыта: пустой экран был бы хуже.
  expect(pickGroup(core, "нет такой")?.key).toBe("код");
  // Групп нет вовсе — и вкладок нет: объект работает как раньше.
  expect(pickGroup(object({}), undefined)).toBeUndefined();
});

/** Превью объекта — его вкладка: названная, а без имени — с `defaultPreview`. */
test("the card picks its group and never falls back to someone else's", () => {
  const core = object({
    metrics: [metric("files"), metric("drift")],
    metricGroups: [
      { key: "код", metrics: ["files"] },
      { key: "превью", metrics: ["drift"], defaultPreview: true },
      { key: "ещё", metrics: ["files"], defaultPreview: true },
    ],
  });

  // Без имени — первая с флагом, а не первая вообще.
  expect(previewGroup(core, undefined).group?.key).toBe("превью");
  expect(previewGroup(core, "код").group?.key).toBe("код");
  // Нет такой вкладки — так и говорится, подмены нет.
  expect(previewGroup(core, "нет такой")).toEqual({ missing: "нет такой" });
  // Флага нет ни у одной — у карточки одна шапка.
  expect(previewGroup(withGroups(), undefined)).toEqual({});
});

test("a group names its metrics and their order", () => {
  const core = withGroups();

  expect(groupMetrics(core, "код").map((found) => found.key)).toEqual(["architecture", "files"]);
  // Метрика, не названная ни в одной группе, не приходит: так её наследуют, не используя.
  expect(groupMetrics(core, "тяжёлое").map((found) => found.key)).toEqual(["drift"]);
  // Без групп приходят все метрики объекта.
  expect(groupMetrics(object({ metrics: [metric("files")] }), undefined)).toHaveLength(1);
});

test("groups come back in the merge", () => {
  const index = objectIndex(withGroups());

  expect(index["metric-groups"]?.groups.map((group) => group.key)).toEqual(["код", "тяжёлое"]);
});
