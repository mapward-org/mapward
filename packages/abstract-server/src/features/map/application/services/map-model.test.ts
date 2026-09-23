import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import type { FilesPort } from "../../../../ports/index.ts";
import { MapModel } from "./map-model.ts";

const timers = { every: () => () => undefined, after: () => () => undefined };
const clock = { now: () => new Date().toISOString() };

/** Карта целиком, как её прочитает сервер: модель одна на вызов, без вотчера. */
const readMap = (files: FilesPort, mapPath: string, basePath: string, name: string) =>
  new MapModel(files, files, timers, clock).current({ mapPath, basePath, name });

/**
 * Карта в памяти вместо диска. Это и есть смысл портов: сервер читается тестом без редактора,
 * без `node:fs` и без временных папок — решение 0014.
 */
function fakeFiles(tree: Record<string, string>): FilesPort {
  const paths = Object.keys(tree);

  return {
    read: (path) => Promise.resolve(tree[path]),
    list: (path) => {
      const prefix = `${path}/`;
      const names = new Map<string, boolean>();
      for (const candidate of paths) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) names.set(rest, false);
        else names.set(rest.slice(0, cut), true);
      }
      return Promise.resolve([...names].map(([name, isDirectory]) => ({ name, isDirectory })));
    },
    write: () => Promise.resolve(),
    remove: (path) => {
      delete tree[path];
      return Promise.resolve();
    },
    watch: () => () => undefined,
  };
}

const MAP = "/map";

const tree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/prototypes/system/_index.json": JSON.stringify({ name: "Система" }),
  "/map/prototypes/system/_metrics/requirements/config.json": JSON.stringify({
    label: "Требования",
  }),
  "/map/prototypes/system/_actions/add-requirement/config.json": JSON.stringify({
    label: "Завести требование",
    inputs: { title: { required: true } },
    runners: [
      { kind: "prompt", prompt: "заведи требование ${{ inputs.title }} у ${{ mapward://~#name }}" },
    ],
  }),
  "/map/prototypes/package/_index.json": JSON.stringify({
    name: "Пакет",
    extends: "mapward://prototypes/system",
  }),
  "/map/prototypes/package/_actions/publish-version/config.json": JSON.stringify({
    runners: [{ kind: "script", run: "pnpm publish" }],
  }),
  "/map/packages/core/_index.json": JSON.stringify({
    name: "core",
    extends: "mapward://prototypes/package",
    props: { codePath: "packages/core" },
  }),
};

test("an object inherits through the chain of prototypes", async () => {
  const map = await readMap(fakeFiles(tree), MAP, "/repo", "Карта");
  const core = map.children
    .flatMap((child) => child.children)
    .find((child) => child.address === "mapward://packages/core");

  expect(core?.prototypeName).toBe("Пакет");
  // Метрика прототипа принадлежит наследнику: свой адрес и свой кэш — решение 0002.
  expect(core?.metrics.map((metric) => metric.address)).toEqual([
    "mapward://packages/core/_metrics/requirements",
  ]);
  expect(core?.metrics[0]?.cachePath).toBe("/map/packages/core/_metrics/requirements");
  expect(core?.metrics[0]?.config.label).toBe("Требования");
});

test("an action inherited twice through a chain appears once", async () => {
  const map = await readMap(fakeFiles(tree), MAP, "/repo", "Карта");
  const core = map.children
    .flatMap((child) => child.children)
    .find((child) => child.address === "mapward://packages/core");

  expect(core?.actions.map((action) => action.key)).toEqual(["add-requirement", "publish-version"]);
});

test("an inherited action belongs to the heir and keeps its owner — decision 0038", async () => {
  const map = await readMap(fakeFiles(tree), MAP, "/repo", "Карта");
  const core = map.children
    .flatMap((child) => child.children)
    .find((child) => child.address === "mapward://packages/core");
  const action = core?.actions.find((entry) => entry.key === "add-requirement");

  expect(action?.address).toBe("mapward://packages/core/_actions/add-requirement");
  expect(action?.owner).toBe("mapward://prototypes/system");
  // Подстановка — по объекту, на котором экшон нажмут, а форма — позже, при запуске.
  expect(action?.config.runners?.[0]?.prompt).toBe("заведи требование ${{ inputs.title }} у core");
});

test("an action extends a shared one and merges its inputs by name", async () => {
  const shared = {
    ...tree,
    "/map/shared-actions/release/config.json": JSON.stringify({
      label: "Выпуск",
      inputs: { level: { type: "choice", options: ["patch", "minor"] } },
      runners: [{ kind: "script", run: "release" }],
    }),
    "/map/packages/core/_actions/release/config.json": JSON.stringify({
      extends: "mapward://shared-actions/release",
      inputs: { dry: { type: "boolean" } },
    }),
  };
  const map = await readMap(fakeFiles(shared), MAP, "/repo", "Карта");
  const core = map.children
    .flatMap((child) => child.children)
    .find((child) => child.address === "mapward://packages/core");
  const release = core?.actions.find((entry) => entry.key === "release");

  expect(release?.config.label).toBe("Выпуск");
  expect(Object.keys(release?.config.inputs ?? {})).toEqual(["level", "dry"]);
  expect(release?.layers.map((layer) => layer.from)).toEqual(["own", "extends"]);
});

test("markdown in _actions is not an action any more, and .mapward is not an object", async () => {
  const old = {
    ...tree,
    "/map/packages/core/_actions/run-dev.md": "как запустить dev",
    "/map/.mapward/runs/_root.json": "[]",
  };
  const map = await readMap(fakeFiles(old), MAP, "/repo", "Карта");
  const core = map.children
    .flatMap((child) => child.children)
    .find((child) => child.address === "mapward://packages/core");

  expect(core?.actions.map((action) => action.key)).not.toContain("run-dev.md");
  expect(map.children.map((child) => child.name)).not.toContain(".mapward");
});

test("substitution resolves against the object that inherited the expression", async () => {
  const withProps = {
    ...tree,
    "/map/prototypes/package/_index.json": JSON.stringify({
      name: "Пакет",
      extends: "mapward://prototypes/system",
      props: { fullPath: "${{ mapward://@ }}/${{ mapward://~#props.codePath }}" },
    }),
  };

  const map = await readMap(fakeFiles(withProps), MAP, "/repo", "Карта");
  const core = map.children
    .flatMap((child) => child.children)
    .find((child) => child.address === "mapward://packages/core");

  expect(core?.props.fullPath).toBe("/repo/packages/core");
});

/**
 * Воркфлоу — решение 0017. Этапы наследуются, как экшоны, но объект может сказать
 * `mode: "replace"`, и тогда унаследованные не приезжают вовсе.
 */
const workflowTree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/prototypes/base/_index.json": JSON.stringify({
    name: "Базовый",
    prompt: "Память карты — ${{ mapward://@ }}/ru/memories/",
    "directives-workflow": { prompt: "и напиши отзыв" },
  }),
  // Прототип посередине цепочки: у него два наследника, и наследуется он столько же раз.
  "/map/prototypes/middle/_index.json": JSON.stringify({
    name: "Средний",
    extends: "mapward://prototypes/base",
    prompt: "тесты гоняются так-то",
    "directives-workflow": { prompt: "и почини линтер" },
  }),
  "/map/prototypes/base/_directives.workflow/обсудить.md":
    "---\nname: Обсудить\norder: 10\n---\n\nскажи, что думаешь\n",
  "/map/prototypes/base/_directives.workflow/выполнить.md":
    "---\nname: Выполнить\norder: 20\nmarks-done: true\n---\n\nсделай\n",
  "/map/apps/editor/_index.json": JSON.stringify({
    name: "Редактор",
    extends: "mapward://prototypes/base",
    prompt: "у редактора есть своя песочница",
  }),
  "/map/apps/first/_index.json": JSON.stringify({
    name: "Первый",
    extends: "mapward://prototypes/middle",
  }),
  "/map/apps/second/_index.json": JSON.stringify({
    name: "Второй",
    extends: "mapward://prototypes/middle",
  }),
  "/map/apps/editor/_directives.workflow/проверка.md":
    "---\nname: Проверка\norder: 15\n---\n\nпроверь\n",
  "/map/apps/own/_index.json": JSON.stringify({
    name: "Свой",
    extends: "mapward://prototypes/base",
    "directives-workflow": { mode: "replace" },
  }),
  "/map/apps/own/_directives.workflow/сделать.md": "---\nname: Сделать\norder: 10\n---\n\nсделай\n",
};

const appOf = (map: Awaited<ReturnType<typeof readMap>>, name: string) =>
  map.children.flatMap((child) => child.children).find((child) => child.name === name);

test("stages are inherited like actions and sorted by order", async () => {
  const map = await readMap(fakeFiles(workflowTree), MAP, "/repo", "Карта");
  const editor = appOf(map, "Редактор");

  // Свой этап встал между унаследованными: порядок задаёт frontmatter, а не имя файла.
  expect(editor?.workflow.map((stage) => stage.name)).toEqual([
    "Обсудить",
    "Проверка",
    "Выполнить",
  ]);
  // Унаследованный помечен владельцем, свой — нет: признак тот же, что у директив.
  expect(editor?.workflow.map((stage) => stage.owner)).toEqual([
    "mapward://prototypes/base",
    undefined,
    "mapward://prototypes/base",
  ]);
  // Отметку о выполнении ставит тот этап, которому это поручено.
  expect(editor?.workflow.find((stage) => stage.marksDone)?.name).toBe("Выполнить");
  // Хук приезжает полем `_index.json`, по обычному правилу наследования.
  expect(editor?.workflowPrompt).toBe("и напиши отзыв");
});

test("replace drops the inherited stages but keeps the hook", async () => {
  const map = await readMap(fakeFiles(workflowTree), MAP, "/repo", "Карта");
  const own = appOf(map, "Свой");

  expect(own?.workflow.map((stage) => stage.name)).toEqual(["Сделать"]);
  expect(own?.workflowPrompt).toBe("и напиши отзыв");
});

/**
 * Решение 0018: промптовые поля складываются. Объект, дописавший себе строчку, иначе молча
 * потерял бы общее правило карты — и заметить это было бы нечем, потому что своя строка
 * при этом работает.
 */
test("prompts add up down the prototype chain instead of replacing", async () => {
  const map = await readMap(fakeFiles(workflowTree), MAP, "/repo", "Карта");
  const editor = appOf(map, "Редактор");

  expect(editor?.prompt).toBe(
    "Память карты — /repo/ru/memories/\n\nу редактора есть своя песочница",
  );
});

/** Правило одно на оба промптовых поля: соседние поля с разными правилами будут путать. */
test("the stage hook adds up by the same rule", async () => {
  const map = await readMap(fakeFiles(workflowTree), MAP, "/repo", "Карта");

  expect(appOf(map, "Первый")?.workflowPrompt).toBe("и напиши отзыв\n\nи почини линтер");
});

/**
 * Прототип наследуется столько раз, сколько у него наследников. Склейка поверх уже склеенного
 * удвоила бы общую часть — поэтому складывается своё, а не то, что уже получилось.
 */
test("a prototype with several heirs does not repeat the inherited prompt", async () => {
  const map = await readMap(fakeFiles(workflowTree), MAP, "/repo", "Карта");

  for (const name of ["Первый", "Второй"]) {
    expect(appOf(map, name)?.prompt).toBe(
      "Память карты — /repo/ru/memories/\n\nтесты гоняются так-то",
    );
  }
});

/** Путь внутри промпта пишется адресом: карта переезжает, а зашитый путь переезжает не с ней. */
test("substitution reaches the prompt fields", async () => {
  const map = await readMap(fakeFiles(workflowTree), MAP, "/repo", "Карта");

  expect(map.children.flatMap((c) => c.children).find((c) => c.name === "Базовый")?.prompt).toBe(
    "Память карты — /repo/ru/memories/",
  );
});

test("the workflow folder is settings, not a child object", async () => {
  const map = await readMap(fakeFiles(workflowTree), MAP, "/repo", "Карта");
  const base = map.children.flatMap((child) => child.children).find((c) => c.name === "Базовый");

  expect(base?.children).toEqual([]);
});

test("an object without stages of its own gets the default workflow", async () => {
  const map = await readMap(fakeFiles(tree), MAP, "/repo", "Карта");
  const core = map.children
    .flatMap((child) => child.children)
    .find((child) => child.address === "mapward://packages/core");

  // Дефолт лежит в самой модели, поэтому клиент и агент видят один и тот же список.
  expect(core?.workflow.map((stage) => stage.name)).toEqual(["Обсудить", "Выполнить"]);
  // У встроенного этапа нет файла — по этому его и отличают от заведённого картой.
  expect(core?.workflow.every((stage) => stage.path === "")).toBe(true);
  expect(core?.workflow.find((stage) => stage.marksDone)?.name).toBe("Выполнить");
});

/**
 * Слои конфига — решение 0019. Цепочка здесь трёхслойная нарочно: клиент по ссылкам ходить
 * не умеет, и если модель отдаст только ближний слой, «дальше ничего нет» не отличить
 * от «дальше не посмотрели».
 */
const layersTree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/shared-metrics/dir/config.json": JSON.stringify({
    refresh: "on-display",
    collectors: [{ kind: "read-dir" }],
  }),
  "/map/shared-metrics/files/config.json": JSON.stringify({
    label: "Файлы",
    extends: "mapward://shared-metrics/dir",
  }),
  "/map/prototypes/system/_index.json": JSON.stringify({ name: "Система" }),
  "/map/prototypes/package/_index.json": JSON.stringify({
    name: "Пакет",
    extends: "mapward://prototypes/system",
  }),
  "/map/prototypes/package/_metrics/files/config.json": JSON.stringify({
    extends: "mapward://shared-metrics/files",
  }),
  "/map/packages/core/_index.json": JSON.stringify({
    name: "core",
    extends: "mapward://prototypes/package",
  }),
  "/map/packages/cli/_index.json": JSON.stringify({
    name: "cli",
    extends: "mapward://prototypes/package",
  }),
  // Наследник дописал метрике одно поле: свой файл встаёт первым слоем, прототипов следом.
  "/map/packages/cli/_metrics/files/config.json": JSON.stringify({ label: "Исходники" }),
  // Вторая метрика, продолжающая ту же общую: цепочка у неё своя и обрываться не должна.
  "/map/apps/site/_index.json": JSON.stringify({ name: "Сайт" }),
  "/map/apps/site/_metrics/files/config.json": JSON.stringify({
    extends: "mapward://shared-metrics/files",
  }),
};

const objectOf = (map: Awaited<ReturnType<typeof readMap>>, address: string) =>
  map.children.flatMap((child) => child.children).find((child) => child.address === address);

test("a metric carries every file its config was merged from", async () => {
  const map = await readMap(fakeFiles(layersTree), MAP, "/repo", "Карта");
  const files = objectOf(map, "mapward://packages/core")?.metrics[0];

  // Своего файла у наследника нет: цепочка начинается прототиповым и уходит в общие.
  expect(files?.layers.map((layer) => layer.from)).toEqual(["prototype", "extends", "extends"]);
  expect(files?.layers.map((layer) => layer.path)).toEqual([
    "/map/prototypes/package/_metrics/files/config.json",
    "/map/shared-metrics/files/config.json",
    "/map/shared-metrics/dir/config.json",
  ]);
  // Первый слой — тот же файл, что `configPath`: это вход в цепочку, а не второе имя.
  expect(files?.layers[0]?.path).toBe(files?.configPath);
});

test("the heir's own file becomes the first layer, the prototype's the next", async () => {
  const map = await readMap(fakeFiles(layersTree), MAP, "/repo", "Карта");
  const files = objectOf(map, "mapward://packages/cli")?.metrics[0];

  expect(files?.layers.map((layer) => layer.from)).toEqual([
    "own",
    "prototype",
    "extends",
    "extends",
  ]);
  expect(files?.layers[0]?.path).toBe("/map/packages/cli/_metrics/files/config.json");
  // Своё выигрывает, дальнее доезжает: иначе по слоям не видно, зачем они.
  expect(files?.config.label).toBe("Исходники");
  expect(files?.config.refresh).toBe("on-display");
});

/**
 * Защита от циклов должна быть своя на каждую цепочку. Общая на всю карту обрывала вторую
 * метрику, продолжающую ту же общую, на первом её слое — и молча, потому что ближний слой
 * при этом приезжал.
 */
test("a second metric extending the same shared one gets the whole chain", async () => {
  const map = await readMap(fakeFiles(layersTree), MAP, "/repo", "Карта");
  const site = objectOf(map, "mapward://apps/site")?.metrics[0];

  // Свой файл, общая и то, что общая продолжает: третий слой и терялся.
  expect(site?.layers.map((layer) => layer.path)).toEqual([
    "/map/apps/site/_metrics/files/config.json",
    "/map/shared-metrics/files/config.json",
    "/map/shared-metrics/dir/config.json",
  ]);
  expect(site?.config.label).toBe("Файлы");
  expect(site?.config.refresh).toBe("on-display");
});

test("an object carries the `_index.json` of every prototype in its chain", async () => {
  const map = await readMap(fakeFiles(layersTree), MAP, "/repo", "Карта");

  expect(objectOf(map, "mapward://packages/core")?.layers).toEqual([
    {
      address: "mapward://packages/core",
      path: "/map/packages/core/_index.json",
      from: "own",
    },
    {
      address: "mapward://prototypes/package",
      path: "/map/prototypes/package/_index.json",
      from: "prototype",
    },
    {
      address: "mapward://prototypes/system",
      path: "/map/prototypes/system/_index.json",
      from: "prototype",
    },
  ]);
});

/** У группы `_index.json` нет, и слоя тоже: пустой путь выглядел бы несуществующим файлом. */
test("a group has no layers", async () => {
  const map = await readMap(fakeFiles(layersTree), MAP, "/repo", "Карта");

  expect(map.children.find((child) => child.name === "shared-metrics")?.layers).toEqual([]);
});

test("a folder starting with an underscore is service, whatever its name", async () => {
  const files = fakeFiles({
    "/map/_index.json": JSON.stringify({ name: "Карта" }),
    "/map/packages/_index.json": JSON.stringify({ name: "Пакеты" }),
    // Служебное перечислять по именам нельзя: правило про `_` шире того, что уже придумано.
    "/map/_drafts/черновик.md": "не объект",
    "/map/_directives.logs/вчера.json": "{}",
  });

  const map = await readMap(files, MAP, "/repo", "Карта");

  expect(map.children.map((child) => child.name)).toEqual(["Пакеты"]);
});

/**
 * Группы метрик — решение 0025. Раздаёт их прототип, наследник правит свои: набор метрик —
 * свойство вида объектов, а не одного объекта.
 */
const groupsTree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/prototypes/package/_index.json": JSON.stringify({
    name: "Пакет",
    "metric-groups": {
      groups: [
        { key: "код", label: "Код", metrics: ["files"] },
        { key: "тяжёлое", metrics: ["architecture"] },
      ],
    },
  }),
  "/map/prototypes/package/_metrics/files/config.json": JSON.stringify({ label: "Файлы" }),
  "/map/prototypes/package/_metrics/architecture/config.json": JSON.stringify({ label: "Арх" }),
  "/map/packages/core/_index.json": JSON.stringify({
    name: "core",
    extends: "mapward://prototypes/package",
    "metric-groups": {
      groups: [
        { key: "код", label: "Код core", metrics: ["files", "architecture"] },
        { key: "своё", metrics: ["files"] },
      ],
    },
  }),
  "/map/packages/docs/_index.json": JSON.stringify({
    name: "docs",
    extends: "mapward://prototypes/package",
    "metric-groups": { mode: "replace", groups: [{ key: "всё", metrics: ["files"] }] },
  }),
};

const packageOf = (map: MapObject, name: string): MapObject | undefined =>
  map.children.flatMap((child) => child.children).find((child) => child.name === name);

test("metric groups are inherited and overridden by key", async () => {
  const map = await readMap(fakeFiles(groupsTree), MAP, "/repo", "Карта");
  const core = packageOf(map, "core");

  // Порядок вкладок задаёт прототип, свои новые встают следом.
  expect(core?.metricGroups.map((group) => group.key)).toEqual(["код", "тяжёлое", "своё"]);
  // Группа с тем же ключом переопределена целиком, а не слита по полям.
  expect(core?.metricGroups[0]).toEqual({
    key: "код",
    label: "Код core",
    metrics: ["files", "architecture"],
  });
});

test("replace drops the inherited groups", async () => {
  const map = await readMap(fakeFiles(groupsTree), MAP, "/repo", "Карта");

  expect(packageOf(map, "docs")?.metricGroups.map((group) => group.key)).toEqual(["всё"]);
});

/** Прототип наследуется многими, и его вкладки не должны накапливаться у него самого. */
test("a prototype with several heirs keeps its own groups", async () => {
  const map = await readMap(fakeFiles(groupsTree), MAP, "/repo", "Карта");
  const prototype = map.children
    .flatMap((child) => child.children)
    .find((child) => child.name === "Пакет");

  expect(prototype?.metricGroups.map((group) => group.key)).toEqual(["код", "тяжёлое"]);
});
