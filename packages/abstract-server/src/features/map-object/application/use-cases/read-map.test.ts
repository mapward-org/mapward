import { expect, test } from "vitest";
import type { FilesPort } from "../../../../ports/index.ts";
import { readMap } from "./read-map.ts";

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
  "/map/prototypes/system/_actions/add-requirement.md": "как завести требование",
  "/map/prototypes/package/_index.json": JSON.stringify({
    name: "Пакет",
    extends: "mapward://prototypes/system",
  }),
  "/map/prototypes/package/_actions/publish-version.md": "как выпустить версию",
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

  expect(core?.actions.map((file) => file.name)).toEqual([
    "add-requirement.md",
    "publish-version.md",
  ]);
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
