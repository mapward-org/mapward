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

/**
 * Подключённая карта — своя модель со своими файлами; родитель знает её только по имени.
 * Карта проекта про родителя не знает, и её адреса и `@` значат своё.
 */
function mounted() {
  const project = memory({
    "/leafer/map/_index.json": JSON.stringify({ name: "Leafer" }),
    "/leafer/map/prototypes/service/_index.json": JSON.stringify({
      name: "Сервис",
      props: { code: "${{ mapward://@ }}/services" },
    }),
    "/leafer/map/prototypes/service/_metrics/files/config.json": JSON.stringify({
      extends: "mapward://shared/files",
    }),
    "/leafer/map/shared/files/config.json": JSON.stringify({ collectors: [{ kind: "static" }] }),
    "/leafer/map/arch/_index.json": JSON.stringify({
      name: "Архитектура",
      props: { team: "leafer", root: "${{ mapward://@ }}" },
    }),
  });
  const own = memory({
    "/map/_index.json": JSON.stringify({ name: "Карта" }),
    "/map/summary/_index.json": JSON.stringify({
      name: "Сводка",
      props: {
        team: "${{ mapward://leafer:/arch#props.team }}",
        root: "${{ mapward://leafer:/arch#props.root }}",
        code: "${{ mapward://leafer:@/src }}",
        missing: "${{ mapward://ed:/core#props.name }}",
      },
    }),
    "/map/api/_index.json": JSON.stringify({
      name: "api",
      extends: "mapward://leafer:/prototypes/service",
    }),
  });
  const leafer = new LiveMap(new LiveFiles(project.source), {
    mapPath: "/leafer/map",
    basePath: "/leafer",
    name: "Leafer",
  });
  const live = new LiveMap(new LiveFiles(own.source), ref, (name) =>
    name === "leafer" ? leafer : `У карты нет подключения «${name}»`,
  );
  return { live, leafer, project };
}

test("подстановка берёт поле объекта подключённой карты, посчитанное от её корня", async () => {
  const { live } = mounted();
  const stop = live.watch(() => undefined);
  await flush();

  const summary = (await live.current()).children.find((child) => child.name === "Сводка");
  expect(summary?.props).toMatchObject({
    team: "leafer",
    root: "/leafer",
    code: "/leafer/src",
    missing: "«не разрешилось: mapward://ed:/core#props.name»",
  });
  stop();
});

test("прототип из подключённой карты наследуется, а его слои пишутся с именем подключения", async () => {
  const { live } = mounted();
  const stop = live.watch(() => undefined);
  await flush();

  const api = (await live.current()).children.find((child) => child.name === "api");
  expect(api?.prototypeName).toBe("Сервис");
  // `@` в прототипе — корень наследника: подстановка считается у конкретного объекта.
  expect(api?.props).toEqual({ code: "/repo/services" });
  expect(api?.layers.map((layer) => layer.address)).toEqual([
    "mapward://api",
    "mapward://leafer:/prototypes/service",
  ]);
  const files = api?.metrics.find((metric) => metric.key === "files");
  expect(files?.owner).toBe("mapward://leafer:/prototypes/service");
  // `extends` метрики прототипа разобран от его карты и прочитан из её файлов.
  expect(files?.config.collectors).toEqual([{ kind: "static" }]);
  expect(files?.layers.at(-1)?.address).toBe("mapward://leafer:/shared/files");
  stop();
});

test("правка файла в подключённой карте доезжает до подстановок родителя", async () => {
  const { live, project } = mounted();
  const stop = live.watch(() => undefined);
  await flush();

  project.write(
    "/leafer/map/arch/_index.json",
    JSON.stringify({ name: "Архитектура", props: { team: "платформа", root: "x" } }),
  );
  await flush();

  const summary = (await live.current()).children.find((child) => child.name === "Сводка");
  expect(summary?.props.team).toBe("платформа");
  stop();
});

test("объект подключённой карты ищется по адресу с её именем", async () => {
  const { live, leafer } = mounted();
  const stop = live.watch(() => undefined);
  await flush();

  expect(live.find("mapward://leafer:/arch")).toBe(leafer.find("mapward://arch"));
  expect(live.find("mapward://ed:/arch")).toBeUndefined();
  expect(live.resolve("mapward://leafer:/arch")).toEqual({
    map: leafer,
    address: "mapward://arch",
  });
  stop();
});
