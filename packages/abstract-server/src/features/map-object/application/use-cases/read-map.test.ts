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
