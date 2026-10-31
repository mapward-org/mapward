import { expect, test } from "vitest";
import { MAP_ROOT } from "@mapward/core";
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
      return () => {
        listeners.splice(listeners.indexOf(onChange), 1);
      };
    },
  };
  const changed = (...paths: string[]) => {
    for (const path of paths) for (const listener of listeners) listener(path);
  };
  return { files, changed, reads, watchers: () => listeners.length };
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

/** Корень с детьми без внуков — тестам хватает его: карта в них в один уровень. */
const root$ = (model: MapModel, at: typeof ref) => model.object$(at, MAP_ROOT, "children");
const root = async (model: MapModel, at: typeof ref) =>
  (await model.object(at, MAP_ROOT, "children")) as MapObject;

test("правка файла доходит до подписчика карты без перечитывания всей карты", async () => {
  const disk = tree();
  const { files, changed, reads } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const seen: MapObject[] = [];
  const subscription = root$(model, ref).subscribe((map) => seen.push(map as MapObject));
  await root(model, ref);
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
  const subscription = root$(model, ref).subscribe((map) => seen.push(map as MapObject));
  await root(model, ref);
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
  // Карту держат: иначе следующее чтение пошло бы на диск и без вотчера.
  const subscription = root$(model, windows).subscribe();
  await root(model, windows);

  disk["D:/map/core/_index.json"] = JSON.stringify({ name: "ядро" });
  changed("d:\\map\\core\\_index.json");
  await settle();

  expect(names(await root(model, windows))).toEqual(["ядро"]);
  subscription.unsubscribe();
});

test("своя запись сервера видна сразу, не дожидаясь вотчера", async () => {
  const disk = tree();
  const { files } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  await root(model, ref);

  // Новая директива — новый файл в папке, которой раньше не было, и его состояние следом.
  await model.writer(files).write("/map/core/_directives/новая.md", "\n## \n\n");
  const core = (await root(model, ref)).children.find((child) => child.name === "core");

  expect(core?.directives.map((file) => [file.name, file.status])).toEqual([["новая.md", "new"]]);
});

test("запись директивы и сразу объект по адресу — она в нём, держит его кто-то или нет", async () => {
  const disk = tree();
  const { files } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const statuses = async () =>
    (await model.object(ref, "mapward://core"))?.directives.map((file) => [file.name, file.status]);

  // Никто не держит: следующее чтение и так идёт на диск.
  await model.writer(files).write("/map/core/_directives/первая.md", "\n## \n\n");
  expect(await statuses()).toEqual([["первая.md", "new"]]);

  // Держат: запись перечитывает тронутое у подписанных, вотчера не ждёт.
  const subscription = model.object$(ref, "mapward://core").subscribe();
  await statuses();
  await model.writer(files).write("/map/core/_directives/вторая.md", "\n## \n\n");
  expect(await statuses()).toEqual([
    ["первая.md", "new"],
    ["вторая.md", "new"],
  ]);
  subscription.unsubscribe();
});

/** Таймеры, у которых срок «держать прочитанное» истекает по кнопке, а остальные — сами. */
function keepTimers() {
  const kept: (() => void)[] = [];
  return {
    timers: {
      every: () => () => undefined,
      after: (ms: number, run: () => void) => {
        if (ms < 1000) return timers.after(ms, run);
        let alive = true;
        kept.push(() => alive && run());
        return () => {
          alive = false;
        };
      },
    },
    expire: () => {
      for (const run of kept.splice(0)) run();
    },
  };
}

test("отписались все и срок вышел — вотчер и файлы отпущены, следующее чтение идёт на диск", async () => {
  const disk = tree();
  const { files, reads, watchers } = liveFiles(disk);
  const { timers: keep, expire } = keepTimers();
  const model = new MapModel(files, files, keep, clock);
  expect(watchers()).toBe(0);

  await model.object(ref, "mapward://core");
  // Срок не вышел: прочитанное держится, и серия вопросов на диск не ходит.
  expect(watchers()).toBe(1);
  const before = reads.length;
  await model.object(ref, "mapward://core");
  expect(reads.length).toBe(before);

  expire();
  await settle();
  expect(watchers()).toBe(0);
  await model.object(ref, "mapward://core");
  expect(reads.length).toBeGreaterThan(before);
});

test("правка ветки, на которую никто не смотрит, не будит ни диск, ни соседние ветки", async () => {
  const disk = tree();
  const { files, changed, reads } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const seen: (MapObject | undefined)[] = [];
  const subscription = model
    .object$(ref, "mapward://docs", "children")
    .subscribe((object) => seen.push(object));
  await model.object(ref, "mapward://docs");
  await settle();
  const before = { seen: seen.length, reads: reads.length };

  disk["/map/core/_index.json"] = JSON.stringify({ name: "ядро" });
  changed("/map/core/_index.json");
  await settle();

  expect(seen.length).toBe(before.seen);
  expect(reads.length).toBe(before.reads);
  subscription.unsubscribe();
});

test("запись кэша метрики карту не пересобирает: в модели её нет", async () => {
  const disk = tree();
  const { files, changed } = liveFiles(disk);
  const model = new MapModel(files, files, timers, clock);
  const seen: MapObject[] = [];
  const subscription = root$(model, ref).subscribe((map) => seen.push(map as MapObject));
  await root(model, ref);
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
  await root(model, ref);

  disk["/map/core/_index.json"] = JSON.stringify({ name: "ядро" });
  disk["/map/tools/_index.json"] = JSON.stringify({ name: "tools" });
  await model.reload(ref);

  expect(names(await root(model, ref))).toEqual(["ядро", "docs", "tools"]);
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
  const subscription = root$(model, ref).subscribe();
  const label = async () => (await root(model, ref)).metrics[0]?.config.label;
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
  subscription.unsubscribe();
});
