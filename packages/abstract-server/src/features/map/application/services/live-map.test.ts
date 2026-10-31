import { Subject } from "rxjs";
import { expect, test } from "vitest";
import { MAP_ROOT, type MapObject } from "@mapward/core";
import { LiveFiles, type FileEntry, type FileSource } from "@mapward/vfs";
import { LiveMap } from "./live-map.ts";

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
  const folders = new Map<string, Set<(entries: FileEntry[]) => void>>();

  const listOf = (path: string): FileEntry[] => {
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

/** Вся карта и каждое её изменение — тестам графа она маленькая и нужна целиком. */
const watchAll = (live: LiveMap, listener: (map: MapObject) => void) => {
  const subscription = live.subtree$(MAP_ROOT, Infinity).subscribe((map) => {
    if (map) listener(map);
  });
  return () => subscription.unsubscribe();
};

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
  const stop = watchAll(live, (map) => seen.push(map));
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
  const stop = watchAll(live, () => undefined);
  await flush();

  write(
    "/map/prototypes/base/_index.json",
    JSON.stringify({ name: "Базовый", props: { team: "платформа" } }),
  );
  await flush();

  const core = (await live.subtree(MAP_ROOT, Infinity))?.children.find(
    (child) => child.name === "core",
  );
  expect(core?.props).toEqual({ team: "платформа", label: "платформа" });
  stop();
});

test("отписались от карты — файлы отпущены", async () => {
  const { source, watched } = memory(tree());
  const live = new LiveMap(new LiveFiles(source), ref);
  const stop = watchAll(live, () => undefined);
  await flush();
  expect(watched()).toBeGreaterThan(0);

  stop();
  await flush();
  expect(watched()).toBe(0);
});

test("срок держать прочитанное — файлы отпускаются, когда он вышел, а не сразу", async () => {
  const { source, watched } = memory(tree());
  const expired = new Subject<void>();
  const live = new LiveMap(new LiveFiles(source, () => expired), ref);
  const stop = watchAll(live, () => undefined);
  await flush();

  stop();
  await flush();
  // Вернувшийся читатель получит то же без диска.
  expect(watched()).toBeGreaterThan(0);

  expired.next();
  await flush();
  expect(watched()).toBe(0);
});

test("поддерево от адреса читает только путь к нему и то, что под ним на нужной глубине", async () => {
  const { source, watched } = memory({
    ...tree(),
    "/map/docs/guide/_index.json": JSON.stringify({ name: "guide" }),
    "/map/docs/guide/deep/_index.json": JSON.stringify({ name: "deep" }),
  });
  const live = new LiveMap(new LiveFiles(source), ref);

  const shallow = await live.subtree("mapward://docs", 1);
  expect(shallow?.children.map((child) => [child.name, child.children.length])).toEqual([
    ["guide", 0],
  ]);
  const whole = await live.subtree("mapward://docs", Infinity);
  expect(whole?.children[0]?.children.map((child) => child.name)).toEqual(["deep"]);
  expect(await live.subtree("mapward://nowhere", 0)).toBeUndefined();
  await flush();
  expect(watched()).toBe(0);
});

test("родители объекта — только объекты: полка без _index.json родителем не считается", async () => {
  const { source } = memory({
    "/map/_index.json": JSON.stringify({ name: "Карта" }),
    // `packages` — полка: папка без индекса.
    "/map/packages/core/_index.json": JSON.stringify({ name: "core" }),
    "/map/packages/core/entry/_index.json": JSON.stringify({ name: "вход" }),
  });
  const live = new LiveMap(new LiveFiles(source), ref);
  const parents = await new Promise<{ address: string; name: string }[]>((resolve) => {
    const subscription = live.ancestors$("mapward://packages/core/entry").subscribe((value) => {
      resolve(value);
      void Promise.resolve().then(() => subscription.unsubscribe());
    });
  });

  expect(parents).toEqual([
    { address: "mapward://", name: "Карта" },
    { address: "mapward://packages/core", name: "core" },
  ]);
});
