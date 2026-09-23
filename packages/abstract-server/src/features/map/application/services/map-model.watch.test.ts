import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import type { FilesPort } from "../../../../ports/index.ts";
import { MapModel } from "./map-model.ts";

/** Таймеры среды: у пакета их типов нет — он не знает, где запущен, — а тесту они нужны. */
const { setTimeout, clearTimeout } = globalThis as unknown as {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/**
 * Диск в памяти с вотчером, который зовёт тест: так видно, что модель пересобирается по
 * изменению, пачкой и только там, где изменилось, — решение 0041.
 */
function liveFiles(tree: Record<string, string>) {
  const listeners: ((path: string) => void)[] = [];
  const reads: string[] = [];
  const files: FilesPort = {
    read: (path) => {
      reads.push(path);
      return Promise.resolve(tree[path]);
    },
    list: (path) => {
      const prefix = `${path}/`;
      const names = new Map<string, boolean>();
      for (const candidate of Object.keys(tree)) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) names.set(rest, false);
        else names.set(rest.slice(0, cut), true);
      }
      return Promise.resolve([...names].map(([name, isDirectory]) => ({ name, isDirectory })));
    },
    write: (path, text) => {
      tree[path] = text;
      return Promise.resolve();
    },
    remove: (path) => {
      delete tree[path];
      return Promise.resolve();
    },
    watch: (_root, onChange) => {
      listeners.push(onChange);
      return () => undefined;
    },
  };
  const changed = (...paths: string[]) => {
    for (const path of paths) for (const listener of listeners) listener(path);
  };
  return { files, changed, reads };
}

/** Таймеры по-настоящему, но быстро: дебаунс вотчера ждёт тишины по часам. */
const timers = {
  every: () => () => undefined,
  after: (_ms: number, run: () => void) => {
    const handle = setTimeout(run, 5);
    return () => clearTimeout(handle);
  },
};
const clock = { now: () => new Date().toISOString() };
const ref = { mapPath: "/map", basePath: "/repo", name: "Карта" };

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 120));

const tree = (): Record<string, string> => ({
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/core/_index.json": JSON.stringify({ name: "core" }),
  "/map/docs/_index.json": JSON.stringify({ name: "docs" }),
});

const names = (map: MapObject) => map.children.map((child) => child.name);

test("правка файла доходит до подписчика карты без перечитывания всей карты", async () => {
  const disk = tree();
  const { files, changed, reads } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const seen: MapObject[] = [];
  const subscription = model.watch(ref).subscribe((map) => seen.push(map));
  await model.current(ref);
  const before = reads.length;

  disk["/map/core/_index.json"] = JSON.stringify({ name: "ядро" });
  changed("/map/core/_index.json");
  await settle();

  expect(names(seen.at(-1) as MapObject)).toEqual(["ядро", "docs"]);
  // Перечитан изменившийся файл, а не карта: соседний объект с диска второй раз не читался.
  expect(reads.slice(before)).toEqual(["/map/core/_index.json"]);
  subscription.unsubscribe();
});

test("пачка изменений уходит наружу одной сборкой", async () => {
  const disk = tree();
  const { files, changed } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const seen: MapObject[] = [];
  const subscription = model.watch(ref).subscribe((map) => seen.push(map));
  await model.current(ref);
  const before = seen.length;

  disk["/map/core/_index.json"] = JSON.stringify({ name: "ядро" });
  disk["/map/docs/_index.json"] = JSON.stringify({ name: "доки" });
  changed("/map/core/_index.json", "/map/docs/_index.json");
  await settle();

  expect(seen.length - before).toBe(1);
  expect(names(seen.at(-1) as MapObject)).toEqual(["ядро", "доки"]);
  subscription.unsubscribe();
});

test("вотчер говорит, путь с обратными слэшами и маленькой буквой диска — модель узнаёт свой файл", async () => {
  const disk: Record<string, string> = {
    "D:/map/_index.json": JSON.stringify({ name: "Карта" }),
    "D:/map/core/_index.json": JSON.stringify({ name: "core" }),
  };
  const { files, changed } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const windows = { mapPath: "D:/map", basePath: "D:/repo", name: "Карта" };
  await model.current(windows);

  disk["D:/map/core/_index.json"] = JSON.stringify({ name: "ядро" });
  changed("d:\\map\\core\\_index.json");
  await settle();

  expect(names(await model.current(windows))).toEqual(["ядро"]);
});

test("своя запись сервера видна сразу, не дожидаясь вотчера", async () => {
  const disk = tree();
  const { files } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  await model.current(ref);

  // Новая директива — новый файл в папке, которой раньше не было, и его состояние следом.
  await model.writer(files).write("/map/core/_directives/новая.md", "\n## \n\n");
  const core = (await model.current(ref)).children.find((child) => child.name === "core");

  expect(core?.directives.map((file) => [file.name, file.status])).toEqual([["новая.md", "new"]]);
});

test("запись кэша метрики карту не пересобирает: в модели её нет", async () => {
  const disk = tree();
  const { files, changed } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const seen: MapObject[] = [];
  const subscription = model.watch(ref).subscribe((map) => seen.push(map));
  await model.current(ref);
  const before = seen.length;

  disk["/map/core/_metrics/files/collect.json"] = "{}";
  changed("/map/core/_metrics/files/collect.json");
  await settle();

  expect(seen.length).toBe(before);
  subscription.unsubscribe();
});

test("перечитать — видно и то, о чём вотчер не сказал", async () => {
  const disk = tree();
  const { files } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  await model.current(ref);

  disk["/map/core/_index.json"] = JSON.stringify({ name: "ядро" });
  disk["/map/tools/_index.json"] = JSON.stringify({ name: "tools" });
  await model.reload(ref);

  expect(names(await model.current(ref))).toEqual(["ядро", "docs", "tools"]);
});

test("поменяли extends у метрики — модель переподписалась на другой слой", async () => {
  const disk: Record<string, string> = {
    "/map/_index.json": JSON.stringify({ name: "Карта" }),
    "/map/shared/a/config.json": JSON.stringify({ label: "А" }),
    "/map/shared/b/config.json": JSON.stringify({ label: "Б" }),
    "/map/_metrics/m/config.json": JSON.stringify({ extends: "mapward://shared/a" }),
  };
  const { files, changed } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const label = async () => (await model.current(ref)).metrics[0]?.config.label;
  expect(await label()).toBe("А");

  disk["/map/_metrics/m/config.json"] = JSON.stringify({ extends: "mapward://shared/b" });
  changed("/map/_metrics/m/config.json");
  await settle();
  expect(await label()).toBe("Б");

  // Слой, на который теперь ссылаются, тоже под слежкой: его правка доходит до метрики.
  disk["/map/shared/b/config.json"] = JSON.stringify({ label: "Бэ" });
  changed("/map/shared/b/config.json");
  await settle();
  expect(await label()).toBe("Бэ");
});
