import { expect, test } from "vitest";
import type { MapObject } from "../model/model.ts";
import type { FolderEntry } from "../model/raw-object.ts";
import { LiveFiles, type FileSource } from "./files.ts";
import { LiveMap } from "./map-tree.ts";

/** Подписчик на путь; последний ушёл — путь больше не под наблюдением. */
const hold = <T>(map: Map<string, Set<T>>, path: string, next: T) => {
  const set = map.get(path) ?? new Set<T>();
  set.add(next);
  map.set(path, set);
  return () => {
    set.delete(next);
    if (set.size === 0) map.delete(path);
  };
};

/**
 * Источник в памяти, как мост у клиента: подписка на файл и папку, правка рассылается
 * подписчикам. Видно, на что модель подписана сейчас.
 */
function memory(tree: Record<string, string>) {
  const files = new Map<string, Set<(text: string | undefined) => void>>();
  const folders = new Map<string, Set<(entries: FolderEntry[]) => void>>();

  const listOf = (path: string): FolderEntry[] => {
    const prefix = `${path}/`;
    const names = new Map<string, boolean>();
    for (const candidate of Object.keys(tree)) {
      if (!candidate.startsWith(prefix)) continue;
      const rest = candidate.slice(prefix.length);
      const cut = rest.indexOf("/");
      if (cut === -1) names.set(rest, false);
      else names.set(rest.slice(0, cut), true);
    }
    return [...names].map(([name, isDirectory]) => ({ name, isDirectory }));
  };

  const source: FileSource = {
    file: (path, next) => {
      void Promise.resolve().then(() => next(tree[path]));
      return hold(files, path, next);
    },
    list: (path, next) => {
      void Promise.resolve().then(() => next(listOf(path)));
      return hold(folders, path, next);
    },
  };

  const write = (path: string, text: string) => {
    tree[path] = text;
    for (const next of files.get(path) ?? []) next(text);
    for (const [folder, listeners] of folders) {
      if (!path.startsWith(`${folder}/`)) continue;
      for (const next of listeners) next(listOf(folder));
    }
  };

  return { source, write, watched: () => files.size + folders.size };
}

const settle = () => new Promise<void>((resolve) => void Promise.resolve().then(() => resolve()));
const flush = async () => {
  for (let tick = 0; tick < 20; tick++) await settle();
};

const ref = { mapPath: "/map", basePath: "/repo", name: "Карта" };

const tree = (): Record<string, string> => ({
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/prototypes/base/_index.json": JSON.stringify({ name: "Базовый", props: { team: "ядро" } }),
  "/map/core/_index.json": JSON.stringify({
    name: "core",
    extends: "mapward://prototypes/base",
    props: { label: "${{ mapward://~#props.team }}" },
  }),
  "/map/docs/_index.json": JSON.stringify({ name: "docs" }),
});

test("правка одного файла пересобирает его ветку, а соседние приходят теми же объектами", async () => {
  const { source, write } = memory(tree());
  const live = new LiveMap(new LiveFiles(source), ref);
  const seen: MapObject[] = [];
  const stop = live.watch((map) => seen.push(map));
  await flush();

  const before = seen.at(-1) as MapObject;
  const core = before.children.find((child) => child.name === "core");
  expect(core?.props).toEqual({ team: "ядро", label: "ядро" });

  write("/map/docs/_index.json", JSON.stringify({ name: "доки" }));
  await flush();

  const after = seen.at(-1) as MapObject;
  expect(seen).toHaveLength(2);
  expect(after.children.map((child) => child.name)).toEqual(["prototypes", "core", "доки"]);
  // Ветка, которой правка не касалась, — тот же объект: React пропустит её сам.
  expect(after.children.find((child) => child.name === "core")).toBe(core);
  stop();
});

test("правка прототипа доходит до наследника и до его подстановок", async () => {
  const { source, write } = memory(tree());
  const live = new LiveMap(new LiveFiles(source), ref);
  const stop = live.watch(() => undefined);
  await flush();

  write(
    "/map/prototypes/base/_index.json",
    JSON.stringify({ name: "Базовый", props: { team: "платформа" } }),
  );
  await flush();

  const core = (await live.current()).children.find((child) => child.name === "core");
  expect(core?.props).toEqual({ team: "платформа", label: "платформа" });
  stop();
});

test("отписались от карты — файлы отпущены", async () => {
  const { source, watched } = memory(tree());
  const live = new LiveMap(new LiveFiles(source), ref);
  const stop = live.watch(() => undefined);
  await flush();
  expect(watched()).toBeGreaterThan(0);

  stop();
  await flush();
  expect(watched()).toBe(0);
});
