import { firstValueFrom } from "rxjs";
import { expect, test } from "vitest";
import { findObject } from "@mapward/core";
import type { ComponentBuild, MapObject } from "@mapward/core";
import type { BuildComponent, BuildInput } from "../use-cases/build-component.ts";
import type { BuildInputs } from "../../domain/build-inputs.ts";
import { BuildCache } from "./build-cache.ts";
import { ComponentBuilds } from "./component-builds.ts";

/**
 * Раскладка группы собирается тем же сервером, что компонент метрики: тот же сборщик, та же
 * сборка на файл. Здесь сборщик — запись того, что его просили собрать.
 */

const ref = { mapPath: "/repo/map", basePath: "/repo", name: "Карта" };

const object = (address: string, path: string, groups: MapObject["metricGroups"]) =>
  ({
    address,
    path,
    name: address,
    isGroup: false,
    props: {},
    layers: [],
    metrics: [],
    directives: [],
    actions: [],
    workflow: [],
    metricGroups: groups,
    children: [],
  }) as MapObject;

const core = object("mapward://packages/core", "/repo/map/packages/core", [
  // Путь уже привязан к папке прототипа — это сделало чтение карты.
  { key: "всё", metrics: ["code"], layout: "/repo/map/prototypes/package/layout.tsx" },
  { key: "адрес", metrics: ["code"], layout: "mapward://prototypes/package/wide.tsx" },
  { key: "список", metrics: ["code"] },
]);
const root = { ...object("mapward://", "/repo/map", []), children: [core] } as MapObject;

/** Диск в памяти: то, что `BuildCache` пишет и читает. */
function disk() {
  const files = new Map<string, string>();
  return {
    files,
    read: (path: string) => Promise.resolve(files.get(path)),
    list: (dir: string) =>
      Promise.resolve(
        [...files.keys()]
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => ({ name: path.slice(dir.length + 1), isDirectory: false })),
      ),
    write: (path: string, text: string) => {
      files.set(path, text);
      return Promise.resolve();
    },
    remove: (path: string) => {
      files.delete(path);
      return Promise.resolve();
    },
  };
}

/**
 * Сборщик — запись того, что его просили собрать. Входы сборки — номер версии файлов: `version`
 * меняется — сверка входов говорит «не те».
 */
function setup(options: { cache?: BuildCache } = {}) {
  const asked: BuildInput[] = [];
  const files = { version: 1 };
  const inputs = (): BuildInputs => ({ reads: { file: String(files.version) }, reals: {} });
  const build = {
    run: (input: BuildInput) => {
      asked.push(input);
      return Promise.resolve({
        build: { code: `// ${input.entry} v${files.version}`, builtAt: "now" } as ComponentBuild,
        watched: [input.entry],
        inputs: inputs(),
      });
    },
    fresh: (given: BuildInputs) => Promise.resolve(given.reads.file === inputs().reads.file),
  } as unknown as BuildComponent;
  const builds = new ComponentBuilds(
    { object: (_ref, address) => Promise.resolve(findObject(root, address)) },
    build,
    { watch: () => () => {} },
    { every: () => () => {}, after: () => () => {} },
    { now: () => "now" },
    options.cache,
  );
  return { builds, asked, files };
}

/** Сборщик и диск здесь отвечают сразу: хватает дать очереди обещаний пройти. */
async function settled() {
  for (let round = 0; round < 50; round++) await Promise.resolve();
}

/** Все сборки, пришедшие подписчику, пока он смотрит. */
function look(builds: ComponentBuilds) {
  const seen: string[] = [];
  const subscription = builds
    .watchLayout(ref, core.address, "всё")
    .subscribe((build) => seen.push(build.code ?? ""));
  return { seen, stop: () => subscription.unsubscribe() };
}

test("раскладка группы собирается из своего файла", async () => {
  const { builds, asked } = setup();
  const build = await firstValueFrom(builds.watchLayout(ref, core.address, "всё"));

  expect(build.code).toBe("// /repo/map/prototypes/package/layout.tsx v1");
  expect(asked).toEqual([{ entry: "/repo/map/prototypes/package/layout.tsx", basePath: "/repo" }]);
});

test("адрес раскладки ведёт в папку карты", async () => {
  const { builds } = setup();
  const build = await firstValueFrom(builds.watchLayout(ref, core.address, "адрес"));

  expect(build.code).toBe("// /repo/map/prototypes/package/wide.tsx v1");
});

test("одна сборка на файл, сколько бы на него ни смотрели", async () => {
  const { builds, asked } = setup();
  const one = builds.watchLayout(ref, core.address, "всё").subscribe();
  await firstValueFrom(builds.watchLayout(ref, core.address, "всё"));
  one.unsubscribe();

  expect(asked).toHaveLength(1);
});

test("без раскладки и без группы — ошибка сборки, а не падение", async () => {
  const { builds, asked } = setup();
  const plain = await firstValueFrom(builds.watchLayout(ref, core.address, "список"));
  const missing = await firstValueFrom(builds.watchLayout(ref, core.address, "нет такой"));

  expect(plain.errors).toEqual(["у группы «список» не задан layout"]);
  expect(missing.errors).toEqual(["у объекта mapward://packages/core нет группы «нет такой»"]);
  expect(asked).toEqual([]);
});

test("вернувшийся подписчик получает прежнюю сборку сразу; входы те же — сборки нет", async () => {
  const { builds, asked } = setup();
  const first = look(builds);
  await settled();
  first.stop();

  const back = look(builds);
  await settled();
  // Прежняя сборка — одна, без повторной: сверка входов сказала «те же».
  expect(back.seen).toEqual(["// /repo/map/prototypes/package/layout.tsx v1"]);
  expect(asked).toHaveLength(1);
  back.stop();
});

test("входы поменялись, пока не смотрели, — прежняя сборка сразу, потом новая", async () => {
  const { builds, asked, files } = setup();
  const first = look(builds);
  await settled();
  first.stop();

  files.version = 2;
  const back = look(builds);
  await settled();
  expect(back.seen).toEqual([
    "// /repo/map/prototypes/package/layout.tsx v1",
    "// /repo/map/prototypes/package/layout.tsx v2",
  ]);
  expect(asked).toHaveLength(2);
  back.stop();
});

test("сборка с диска: новое окно начинает с неё и не собирает, пока входы те же", async () => {
  const files = disk();
  const before = setup({ cache: new BuildCache(files, "stamp") });
  const first = look(before.builds);
  await settled();
  first.stop();
  expect(
    [...files.files.keys()].some((path) => path.startsWith("/repo/map/.mapward/builds/")),
  ).toBe(true);

  // Новое окно — новый сервер, тот же диск.
  const after = setup({ cache: new BuildCache(files, "stamp") });
  const back = look(after.builds);
  await settled();
  expect(back.seen).toEqual(["// /repo/map/prototypes/package/layout.tsx v1"]);
  expect(after.asked).toEqual([]);
  back.stop();

  // Другой сборщик — сохранённое не годится.
  const updated = setup({ cache: new BuildCache(files, "другой") });
  const fresh = look(updated.builds);
  await settled();
  expect(updated.asked).toHaveLength(1);
  fresh.stop();
});

test("стереть кэш: файлы на диске уходят, то, на что смотрят, собирается заново", async () => {
  const files = disk();
  const { builds, asked } = setup({ cache: new BuildCache(files, "stamp") });
  const shown = look(builds);
  await settled();

  expect(await builds.clearCache(ref)).toEqual({ removed: 1, rebuilt: 1 });
  await settled();
  expect(asked).toHaveLength(2);
  shown.stop();
});
