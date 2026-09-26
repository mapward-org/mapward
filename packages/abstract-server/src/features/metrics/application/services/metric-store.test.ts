import { Subject, type Observable } from "rxjs";
import { expect, test } from "vitest";
import type { MapObject } from "@mapward/core";
import type { FilesPort, ServerPorts } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { MapModel } from "../../../map/index.ts";
import { DisplaySchema } from "../../../displays/index.ts";
import { Executor } from "../../../execution/index.ts";
import type { MetricHistory } from "../../ports.ts";
import { CollectMetric } from "../use-cases/collect-metric.ts";
import { TransformMetric } from "../use-cases/transform-metric.ts";
import { Builtins } from "./builtins.ts";
import { GitStatus } from "./git-status.ts";
import { MetricCache } from "./metric-cache.ts";
import { MetricStore, type MetricSettings } from "./metric-store.ts";

/** Таймер среды: у пакета его типов нет — он не знает, где запущен, — а тесту он нужен. */
const { setTimeout } = globalThis as unknown as {
  setTimeout: (run: () => void, ms: number) => unknown;
};

/** Карта целиком, как её прочитает сервер: модель одна на вызов, без вотчера. */
function readMap(files: FilesPort, mapPath: string, basePath: string, name: string) {
  const timers = { every: () => () => undefined, after: () => () => undefined };
  const clock = { now: () => new Date().toISOString() };
  return new MapModel(files, files, timers, clock).current({ mapPath, basePath, name });
}

/** Стор, собранный так же, как в сборке сервера; карта приходит снаружи. */
function createMetricStore(
  ports: ServerPorts,
  read: (ref: MapRef) => Promise<MapObject>,
  settings: MetricSettings = {},
  history?: MetricHistory,
  live?: (ref: MapRef) => Observable<MapObject>,
) {
  const { files, shell, agent, env, timers, clock } = ports;
  const executor = new Executor(shell, agent);
  const schema = new DisplaySchema(files);
  const cache = new MetricCache(files, files);
  const builtins = new Builtins(new GitStatus(shell, files, env, timers, clock));
  return new MetricStore(
    { current: read, ...(live ? { watch: live } : {}) },
    cache,
    new CollectMetric(files, cache, schema, executor, env, clock),
    new TransformMetric(builtins, cache, schema, executor, env, clock),
    builtins,
    schema,
    timers,
    clock,
    files,
    settings,
    history,
  );
}

/** Карта в памяти: стор проверяется без редактора и без диска — решение 0014. */
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

function fakePorts(tree: Record<string, string>): ServerPorts {
  return {
    files: fakeFiles(tree),
    shell: {
      run: () => Promise.resolve({ stdout: '{"text":"из скрипта"}', stderr: "" }),
      pipe: () => Promise.resolve({ stdout: "{}", stderr: "" }),
    },
    agent: { run: () => Promise.resolve({ stdout: "{}", stderr: "" }) },
    clock: { now: () => new Date().toISOString() },
    timers: { every: () => () => undefined, after: () => () => undefined },
    env: { vars: () => ({}) },
    capabilities: {
      terminals: false,
      openFile: false,
      ask: false,
      virtualDocs: false,
      tabs: false,
    },
  };
}

const MAP = "/map";
const ref: MapRef = { mapPath: MAP, basePath: "/repo", name: "Карта" };

const tree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/_metrics/version/config.json": JSON.stringify({
    label: "Версия",
    refresh: "on-display",
    collectors: [{ kind: "script", run: "echo hi" }],
    display: { kind: "text" },
  }),
  "/map/_metrics/waiting/config.json": JSON.stringify({
    label: "Ручная",
    collectors: [{ kind: "static", value: { text: "не должно собраться" } }],
    display: { kind: "text" },
  }),
};

/** Ждём, пока подписка отдаст значение, которое нас устраивает. */
function until(
  store: ReturnType<typeof createMetricStore>,
  address: string,
  ok: (value: { data?: unknown; busy?: boolean } | undefined) => boolean,
): Promise<Record<string, { data?: unknown; busy?: boolean }>> {
  return new Promise((resolve, reject) => {
    let ticks = 0;
    const subscription = store.watch(ref, "mapward://").subscribe((snapshot) => {
      if (ok(snapshot[address])) {
        subscription.unsubscribe();
        resolve(snapshot);
      }
    });

    // Пакет не знает про таймеры среды, поэтому ждём микротасками: прогон здесь весь на моках.
    const tick = () => {
      if (subscription.closed) return;
      if (++ticks > 1000) {
        subscription.unsubscribe();
        reject(new Error("значение так и не пришло"));
        return;
      }
      void Promise.resolve().then(tick);
    };
    tick();
  });
}

test("on-display collects as soon as the object is open", async () => {
  const ports = fakePorts(tree);
  const store = createMetricStore(ports, (params) =>
    readMap(ports.files, params.mapPath, params.basePath, params.name),
  );

  // Никто ничего не нажимал: подписка и есть «объект открыт» — решение 0013.
  const snapshot = await until(
    store,
    "mapward://_metrics/version",
    (value) => value?.data !== undefined,
  );

  expect(snapshot["mapward://_metrics/version"]?.data).toEqual({ text: "из скрипта" });
});

test("manual waits for the button", async () => {
  const ports = fakePorts(tree);
  const store = createMetricStore(ports, (params) =>
    readMap(ports.files, params.mapPath, params.basePath, params.name),
  );

  await until(store, "mapward://_metrics/version", (value) => value?.data !== undefined);

  const subscription = store.watch(ref, "mapward://").subscribe();
  await Promise.resolve();
  subscription.unsubscribe();

  const value = await store.run(ref, "mapward://_metrics/waiting");
  expect(value.data).toEqual({ text: "не должно собраться" });
});

/** Объект карты для чтения: стор читает метрики у того, кого ему дали. */
const objectOf = (ports: ServerPorts) => readMap(ports.files, ref.mapPath, ref.basePath, ref.name);

test("read without refresh returns the cache and starts nothing", async () => {
  const ports = fakePorts(tree);
  const store = createMetricStore(ports, () => objectOf(ports));

  const snapshot = await store.read(ref, await objectOf(ports));

  // Кэша на диске нет, а запускать чтение не просили — значит показывать нечего.
  expect(snapshot["mapward://_metrics/version"]?.data).toBeUndefined();
  expect(snapshot["mapward://_metrics/waiting"]?.data).toBeUndefined();
});

test("read with on-display fills the cheap metrics and leaves manual alone", async () => {
  const ports = fakePorts(tree);
  const store = createMetricStore(ports, () => objectOf(ports));

  const snapshot = await store.read(ref, await objectOf(ports), { refresh: "on-display" });

  // То же, что человек видит, открыв объект, — решение 0016.
  expect(snapshot["mapward://_metrics/version"]?.data).toEqual({ text: "из скрипта" });
  // Дорогое так не считается ни у человека, ни у агента.
  expect(snapshot["mapward://_metrics/waiting"]?.data).toBeUndefined();
});

/**
 * Считает прогоны скрипта: свежесть видна только по тому, запустился коллектор или нет.
 *
 * Часы идут вперёд на секунду за взгляд — иначе оба чтения случаются в одну миллисекунду,
 * возраст выходит нулевым и ничто не успевает протухнуть.
 */
function countingPorts(files: Record<string, string>): ServerPorts & { runs: () => number } {
  const base = fakePorts(files);
  let runs = 0;
  let clock = Date.parse("2026-09-19T12:00:00.000Z");
  return {
    ...base,
    clock: {
      now: () => {
        clock += 1000;
        return new Date(clock).toISOString();
      },
    },
    shell: {
      ...base.shell,
      run: (...args) => {
        runs++;
        return base.shell.run(...args);
      },
    },
    runs: () => runs,
  };
}

test("a map-wide staleTime keeps the second read from collecting again", async () => {
  const ports = countingPorts(tree);
  const store = createMetricStore(ports, () => objectOf(ports), { collectorsStaleTime: 60_000 });

  await store.read(ref, await objectOf(ports), { refresh: "on-display" });
  await store.read(ref, await objectOf(ports), { refresh: "on-display" });

  // Настройка карты — умолчание для метрик, у которых своего срока нет (решение 0016).
  expect(ports.runs()).toBe(1);
});

test("without it every read collects anew, as before", async () => {
  const ports = countingPorts(tree);
  const store = createMetricStore(ports, () => objectOf(ports));

  await store.read(ref, await objectOf(ports), { refresh: "on-display" });
  await store.read(ref, await objectOf(ports), { refresh: "on-display" });

  expect(ports.runs()).toBe(2);
});

test("what the metric says about itself wins over the map-wide default", async () => {
  const own = {
    ...tree,
    "/map/_metrics/version/config.json": JSON.stringify({
      label: "Версия",
      refresh: "on-display",
      // Своя свежесть нулевая: значит протухает сразу, что бы ни стояло на карте.
      collectorsStaleTime: 0,
      collectors: [{ kind: "script", run: "echo hi" }],
      display: { kind: "text" },
    }),
  };
  const ports = countingPorts(own);
  const store = createMetricStore(ports, () => objectOf(ports), { collectorsStaleTime: 60_000 });

  await store.read(ref, await objectOf(ports), { refresh: "on-display" });
  await store.read(ref, await objectOf(ports), { refresh: "on-display" });

  expect(ports.runs()).toBe(2);
});

test("an expired timeout is a failure, not a cancel", async () => {
  const base = fakePorts({
    ...tree,
    "/map/_metrics/version/config.json": JSON.stringify({
      label: "Версия",
      refresh: "on-display",
      collectorsTimeout: 5,
      collectors: [{ kind: "script", run: "sleep forever" }],
      display: { kind: "text" },
    }),
  });

  const ports: ServerPorts = {
    ...base,
    // Скрипт не кончается сам: его снимает отмена, как это делает настоящий адаптер.
    shell: {
      ...base.shell,
      run: (_command, options) =>
        new Promise((_resolve, reject) => {
          options.cancel?.onCancel(() => reject(new Error("убит")));
        }),
    },
    timers: {
      ...base.timers,
      after: (_ms, run) => {
        void Promise.resolve().then(run);
        return () => undefined;
      },
    },
  };

  const store = createMetricStore(ports, () => objectOf(ports));
  const snapshot = await store.read(ref, await objectOf(ports), { refresh: "on-display" });

  const value = snapshot["mapward://_metrics/version"];
  expect(value?.ok).toBe(false);
  expect(value?.updatedAt).toBeDefined();
});

test("an expired timeout says so in the log", async () => {
  const writes: Record<string, string> = {};
  const base = fakePorts({
    ...tree,
    "/map/_metrics/version/config.json": JSON.stringify({
      label: "Версия",
      refresh: "on-display",
      collectorsTimeout: 5,
      collectors: [{ kind: "script", run: "sleep forever" }],
      display: { kind: "text" },
    }),
  });

  const ports: ServerPorts = {
    ...base,
    files: {
      ...base.files,
      write: (path, text) => {
        writes[path] = text;
        return Promise.resolve();
      },
    },
    shell: {
      ...base.shell,
      run: (_command, options) =>
        new Promise((_resolve, reject) => {
          options.cancel?.onCancel(() => reject(new Error("убит")));
        }),
    },
    timers: {
      ...base.timers,
      after: (_ms, run) => {
        void Promise.resolve().then(run);
        return () => undefined;
      },
    },
  };

  const store = createMetricStore(ports, () => objectOf(ports));
  await store.read(ref, await objectOf(ports), { refresh: "on-display" });

  // Снятый по времени прогон падает отменой и до своей записи не доходит, поэтому причину
  // пишет стор: без неё красная точка ведёт в пустоту.
  expect(writes["/map/_metrics/version/collect.logs.json"]).toContain("время вышло");
  expect(writes["/map/_metrics/version/collect.logs.json"]).toContain("5");
});

test("a failed collect keeps the value that was already shown", async () => {
  const base = fakePorts({
    ...tree,
    // Кэша на диске нет намеренно: прошлое значение живёт только в сторе.
    "/map/_metrics/version/config.json": JSON.stringify({
      label: "Версия",
      collectors: [{ kind: "script", run: "echo hi" }],
      display: { kind: "text" },
    }),
  });

  let attempt = 0;
  const ports: ServerPorts = {
    ...base,
    shell: {
      ...base.shell,
      run: (...args) => {
        attempt += 1;
        return attempt === 1 ? base.shell.run(...args) : Promise.reject(new Error("скрипт упал"));
      },
    },
  };

  const store = createMetricStore(ports, () => objectOf(ports));
  const first = await store.run(ref, "mapward://_metrics/version");
  expect(first.data).toEqual({ text: "из скрипта" });

  const second = await store.run(ref, "mapward://_metrics/version");
  expect(second.ok).toBe(false);
  // Значение было верным, обновить его не смогли — это честнее пустоты (решение 0004).
  expect(second.data).toEqual({ text: "из скрипта" });
});

test("the refresh button runs after a read that skipped by freshness", async () => {
  const ports = countingPorts(tree);
  const store = createMetricStore(ports, () => objectOf(ports), { collectorsStaleTime: 600_000 });

  await store.read(ref, await objectOf(ports), { refresh: "on-display" });
  await store.read(ref, await objectOf(ports), { refresh: "on-display" });
  expect(ports.runs()).toBe(1);

  // Пропуск по свежести — это тоже конец прогона: не сняв отметку, метрика замерла бы навсегда
  // и кнопка обновления перестала бы работать вместе с тиками интервала.
  await store.run(ref, "mapward://_metrics/version");

  expect(ports.runs()).toBe(2);
});

/**
 * Карта с метрикой, у которой встроенный шаг: коллектор статичный, чтобы стадия сбора не мешала
 * смотреть на стадию трансформа.
 */
const markedTree = {
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/_metrics/marked/config.json": JSON.stringify({
    label: "Файлы",
    refresh: "on-display",
    collectors: [{ kind: "static", value: { children: [{ label: "a.ts", link: "/repo/a.ts" }] } }],
    transforms: [{ kind: "git-status" }],
    // Сроки заданы нарочно большими: по ним стадия трансформа обязана считаться свежей.
    collectorsStaleTime: 600_000,
    transformsStaleTime: 600_000,
    display: { kind: "tree" },
  }),
};

/**
 * Git отвечает по-разному на первый и второй прогон: по тому, доехала ли вторая пометка до
 * значения, и видно, считалась стадия трансформа заново или её удержала свежесть.
 *
 * Часы идут вперёд на пять секунд за взгляд: кэш статуса живёт две, и без хода времени второй
 * прогон читал бы собранное в первый.
 */
function gitPorts(files: Record<string, string>): ServerPorts {
  const base = fakePorts(files);
  let asked = 0;
  let clock = Date.parse("2026-09-19T12:00:00.000Z");

  return {
    ...base,
    clock: {
      now: () => {
        clock += 5000;
        return new Date(clock).toISOString();
      },
    },
    shell: {
      ...base.shell,
      run: (command, options) => {
        if (command.startsWith("git rev-parse")) {
          return Promise.resolve({ stdout: "/repo\n/repo/.git\n", stderr: "" });
        }
        if (command.startsWith("git status")) {
          asked += 1;
          return Promise.resolve({ stdout: asked === 1 ? "" : " M a.ts\0", stderr: "" });
        }
        return base.shell.run(command, options);
      },
    },
  };
}

const letterOfFirstChild = (snapshot: Record<string, { data?: unknown }>): string | undefined =>
  (snapshot["mapward://_metrics/marked"]?.data as { children?: { git?: string }[] } | undefined)
    ?.children?.[0]?.git;

test("встроенному шагу свежесть не считается: пометка обновляется, пока сбор стоит", async () => {
  const ports = gitPorts(markedTree);
  const store = createMetricStore(ports, () => objectOf(ports));

  const first = await store.read(ref, await objectOf(ports), { refresh: "on-display" });
  expect(letterOfFirstChild(first)).toBeUndefined();

  const second = await store.read(ref, await objectOf(ports), { refresh: "on-display" });
  // `transformsStaleTime` на шаг со своим состоянием не действует — решение 0023.
  expect(letterOfFirstChild(second)).toBe("M");
});

test("обычный трансформ той же свежестью удерживается", async () => {
  const scripted = {
    "/map/_index.json": JSON.stringify({ name: "Карта" }),
    "/map/_metrics/marked/config.json": JSON.stringify({
      label: "Файлы",
      refresh: "on-display",
      collectors: [{ kind: "static", value: { children: [] } }],
      transforms: [{ kind: "script", run: "cat" }],
      collectorsStaleTime: 600_000,
      transformsStaleTime: 600_000,
      display: { kind: "tree" },
    }),
  };

  const ports = gitPorts(scripted);
  let piped = 0;
  const counted: ServerPorts = {
    ...ports,
    shell: {
      ...ports.shell,
      pipe: (...args) => {
        piped += 1;
        return ports.shell.pipe(...args);
      },
    },
  };
  const store = createMetricStore(counted, () =>
    readMap(counted.files, ref.mapPath, ref.basePath, ref.name),
  );

  await store.read(ref, await readMap(counted.files, ref.mapPath, ref.basePath, ref.name), {
    refresh: "on-display",
  });
  await store.read(ref, await readMap(counted.files, ref.mapPath, ref.basePath, ref.name), {
    refresh: "on-display",
  });

  expect(piped).toBe(1);
});

/** Крутим микротаски, пока не сойдётся условие: прогон здесь весь на моках. */
function spin(ok: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let ticks = 0;
    const tick = () => {
      if (ok()) {
        resolve();
        return;
      }
      if (++ticks > 2000) {
        reject(new Error("значение так и не пришло"));
        return;
      }
      void Promise.resolve().then(tick);
    };
    tick();
  });
}

test("тик вотчера гонит один трансформ: коллекторы не трогаются", async () => {
  const scripted = {
    "/map/_index.json": JSON.stringify({ name: "Карта" }),
    "/map/_metrics/marked/config.json": JSON.stringify({
      label: "Файлы",
      refresh: "on-display",
      // Срок сбору не задан нарочно: сбор протух, и не побежал он только потому, что тик
      // вотчера гонит одну стадию — решение 0023.
      collectors: [{ kind: "script", run: "echo tree" }],
      transforms: [{ kind: "git-status" }],
      display: { kind: "tree" },
    }),
  };

  const ports = gitPorts(scripted);
  let collects = 0;
  let poke: (() => void) | undefined;

  const watched: ServerPorts = {
    ...ports,
    files: {
      ...ports.files,
      watch: (root, onChange, options) => {
        // Вотчер встроенного шага узнаётся по `include`: карта следится без него.
        if (!options?.include) return ports.files.watch(root, onChange, options);
        poke = () => onChange("index");
        return () => {
          poke = undefined;
        };
      },
    },
    shell: {
      ...ports.shell,
      run: (command, options) => {
        if (command.startsWith("echo")) {
          collects += 1;
          return Promise.resolve({
            stdout: JSON.stringify({ children: [{ label: "a.ts", link: "/repo/a.ts" }] }),
            stderr: "",
          });
        }
        return ports.shell.run(command, options);
      },
    },
    timers: {
      ...ports.timers,
      after: (_ms, run) => {
        void Promise.resolve().then(run);
        return () => undefined;
      },
    },
  };

  const store = createMetricStore(watched, () =>
    readMap(watched.files, ref.mapPath, ref.basePath, ref.name),
  );

  let latest: Record<string, { data?: unknown }> = {};
  const subscription = store.watch(ref, "mapward://").subscribe((snapshot) => {
    latest = snapshot;
  });

  // Первый прогон: git отвечает пустым статусом, пометок нет.
  await spin(() => latest["mapward://_metrics/marked"]?.data !== undefined);
  expect(collects).toBe(1);
  expect(letterOfFirstChild(latest)).toBeUndefined();

  await spin(() => poke !== undefined);
  poke?.();

  await spin(() => letterOfFirstChild(latest) === "M");
  // Стадия сбора не повторилась, хотя свежей её никто не объявлял.
  expect(collects).toBe(1);

  subscription.unsubscribe();
});

test("вкладка открывается сразу: первый снимок не ждёт кэша, не поднятое ещё — с пометкой", async () => {
  // Кэш с диска отдаётся, только когда тест разрешит: так видно, что ждёт не снимок, а метрика.
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cached = {
    ...tree,
    "/map/_metrics/waiting/collect.json": JSON.stringify({
      updatedAt: "2026-09-23T10:00:00.000Z",
      ok: true,
      data: { text: "собрано раньше" },
    }),
  };
  const ports = fakePorts(cached);
  const read = ports.files.read;
  ports.files.read = async (path) => {
    if (path.endsWith("collect.json")) await gate;
    return read(path);
  };
  const map = await readMap(ports.files, ref.mapPath, ref.basePath, ref.name);
  const store = createMetricStore(ports, () => Promise.resolve(map));

  const snapshots: Record<string, { collected?: boolean; loading?: boolean; data?: unknown }>[] =
    [];
  const subscription = store.watch(ref, "mapward://").subscribe((snapshot) => {
    snapshots.push(snapshot);
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 10));

  // Кэш ещё не поднят, а снимок уже пришёл: метрика в нём есть и честно «ещё поднимается».
  expect(snapshots[0]?.["mapward://_metrics/waiting"]).toMatchObject({
    collected: false,
    loading: true,
  });

  release?.();
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  const last = snapshots.at(-1)?.["mapward://_metrics/waiting"];
  expect(last?.data).toEqual({ text: "собрано раньше" });
  expect(last?.loading).toBeUndefined();
  subscription.unsubscribe();
});

/**
 * Порты для вотчера шага — решение 0043: вотчер порта запоминается по папке, и тест сам зовёт
 * его, когда «файл поменялся». Таймеры идут микротасками, поэтому дебаунс — одна пауза.
 */
function stepWatchPorts(
  files: Record<string, string>,
  script: (command: string, cancel?: { onCancel(run: () => void): void }) => Promise<string>,
) {
  const base = fakePorts(files);
  const watchers = new Map<string, (path: string) => void>();
  const ports: ServerPorts = {
    ...base,
    files: {
      ...base.files,
      watch: (root, onChange) => {
        watchers.set(root, onChange);
        return () => watchers.delete(root);
      },
    },
    shell: {
      run: async (command, options) => ({
        stdout: await script(command, options.cancel),
        stderr: "",
      }),
      pipe: async (command, options) => ({
        stdout: await script(command, options.cancel),
        stderr: "",
      }),
    },
    timers: {
      ...base.timers,
      after: (_ms, run) => {
        void Promise.resolve().then(run);
        return () => undefined;
      },
    },
  };
  return { ports, watchers };
}

function recordingHistory() {
  const runs: { source: string; steps: string[]; end?: string }[] = [];
  const history: MetricHistory = {
    recordMetric: (_map, info) => {
      const run: { source: string; steps: string[]; end?: string } = {
        source: info.source,
        steps: [],
      };
      runs.push(run);
      return {
        step: (name) => run.steps.push(name),
        stepDone: (status) => run.steps.push(status),
        end: (status) => {
          run.end = status;
        },
      };
    },
  };
  return { runs, history };
}

const pairTree = (refresh: string) => ({
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/_metrics/pair/config.json": JSON.stringify({
    label: "Пара",
    refresh,
    collectors: [
      { kind: "script", name: "cheap", run: "echo cheap", watch: { include: ["src/**"] } },
      { kind: "script", name: "costly", run: "echo costly" },
    ],
    display: { kind: "text" },
  }),
});

test("вотчер коллектора пересобирает только свой коллектор, сосед отдаёт прошлое", async () => {
  const counts: Record<string, number> = {};
  const { ports, watchers } = stepWatchPorts(pairTree("on-display"), (command) => {
    const name = command.replace("echo ", "");
    counts[name] = (counts[name] ?? 0) + 1;
    return Promise.resolve(JSON.stringify({ n: counts[name] }));
  });
  const { runs, history } = recordingHistory();
  const store = createMetricStore(
    ports,
    () => readMap(ports.files, ref.mapPath, ref.basePath, ref.name),
    // Часы здесь настоящие: дебаунс в триста мс микротасками не дождаться.
    { watchDebounce: 0 },
    history,
  );

  let latest: Record<string, { data?: unknown; busy?: boolean }> = {};
  const subscription = store.watch(ref, "mapward://").subscribe((snapshot) => {
    latest = snapshot;
  });

  const address = "mapward://_metrics/pair";
  await spin(() => latest[address]?.data !== undefined && latest[address]?.busy === false);
  await spin(() => watchers.has("/map/src"));

  watchers.get("/map/src")?.("/map/src/a.ts");
  await spin(() => counts.cheap === 2 && latest[address]?.busy === false);

  expect(counts.costly).toBe(1);
  expect(latest[address]?.data).toEqual({ cheap: { n: 2 }, costly: { n: 1 } });
  expect(runs.at(-1)?.source).toBe("watch");

  // Изменение мимо глобов вотчер не будит.
  watchers.get("/map/src")?.("/map/other/b.ts");
  await spin(() => true);
  expect(counts.cheap).toBe(2);

  subscription.unsubscribe();
  expect(watchers.has("/map/src")).toBe(false);
});

test("вотчер снимает идущий коллектор и начинает его заново внутри того же прогона", async () => {
  const counts: Record<string, number> = {};
  let hold: (() => void) | undefined;
  let cancelled = 0;
  const { ports, watchers } = stepWatchPorts(pairTree("manual"), (command, cancel) => {
    const name = command.replace("echo ", "");
    counts[name] = (counts[name] ?? 0) + 1;
    const n = counts[name];
    // Первая попытка дешёвого висит, пока её не снимут или не отпустят.
    if (name === "cheap" && n === 1) {
      return new Promise((resolve, reject) => {
        hold = () => resolve(JSON.stringify({ n }));
        cancel?.onCancel(() => {
          cancelled += 1;
          reject(new Error("снят"));
        });
      });
    }
    return Promise.resolve(JSON.stringify({ n }));
  });
  const { runs, history } = recordingHistory();
  const store = createMetricStore(
    ports,
    () => readMap(ports.files, ref.mapPath, ref.basePath, ref.name),
    // Часы здесь настоящие: дебаунс в триста мс микротасками не дождаться.
    { watchDebounce: 0 },
    history,
  );

  // `manual` ждёт кнопки, но вотчер у написанного `watch` ставится всё равно.
  const subscription = store.watch(ref, "mapward://").subscribe(() => undefined);
  await spin(() => watchers.has("/map/src"));
  expect(counts.cheap).toBeUndefined();

  const running = store.run(ref, "mapward://_metrics/pair");
  await spin(() => hold !== undefined);

  watchers.get("/map/src")?.("/map/src/a.ts");
  const value = await running;

  expect(cancelled).toBe(1);
  expect(counts).toEqual({ cheap: 2, costly: 1 });
  expect(value.data).toEqual({ cheap: { n: 2 }, costly: { n: 1 } });
  expect(value.ok).toBe(true);
  // Один прогон, и он не неудача.
  expect(runs).toHaveLength(1);
  expect(runs[0]?.end).toBe("success");

  subscription.unsubscribe();
});

test("вотчер трансформа гонит только трансформы, сбор не трогается", async () => {
  const counts: Record<string, number> = {};
  const { ports, watchers } = stepWatchPorts(
    {
      "/map/_index.json": JSON.stringify({ name: "Карта" }),
      "/map/_metrics/shaped/config.json": JSON.stringify({
        label: "Форма",
        refresh: "on-display",
        collectors: [{ kind: "script", run: "echo collect" }],
        transforms: [{ kind: "script", run: "echo shape", watch: { include: ["rules/*.md"] } }],
        display: { kind: "text" },
      }),
    },
    (command) => {
      const name = command.replace("echo ", "");
      counts[name] = (counts[name] ?? 0) + 1;
      return Promise.resolve(JSON.stringify({ n: counts[name] }));
    },
  );
  const store = createMetricStore(
    ports,
    () => readMap(ports.files, ref.mapPath, ref.basePath, ref.name),
    { watchDebounce: 0 },
  );

  let latest: Record<string, { data?: unknown; busy?: boolean }> = {};
  const subscription = store.watch(ref, "mapward://").subscribe((snapshot) => {
    latest = snapshot;
  });
  const address = "mapward://_metrics/shaped";
  await spin(() => latest[address]?.data !== undefined && latest[address]?.busy === false);
  await spin(() => watchers.has("/map/rules"));

  watchers.get("/map/rules")?.("/map/rules/one.md");
  await spin(() => counts.shape === 2 && latest[address]?.busy === false);

  expect(counts.collect).toBe(1);
  expect(latest[address]?.data).toEqual({ n: 2 });
  subscription.unsubscribe();
});

test("правка watch в живой карте переставляет вотчер, не дожидаясь нового открытия", async () => {
  const files = pairTree("manual");
  const { ports, watchers } = stepWatchPorts(files, () => Promise.resolve("{}"));
  const changes = new Subject<MapObject>();
  const read = () => readMap(ports.files, ref.mapPath, ref.basePath, ref.name);
  const store = createMetricStore(ports, read, { watchDebounce: 0 }, undefined, () => changes);

  const subscription = store.watch(ref, "mapward://").subscribe(() => undefined);
  await spin(() => watchers.has("/map/src"));

  files["/map/_metrics/pair/config.json"] = JSON.stringify({
    label: "Пара",
    collectors: [
      { kind: "script", name: "cheap", run: "echo cheap", watch: { include: ["lib/**"] } },
    ],
    display: { kind: "text" },
  });
  changes.next(await read());

  await spin(() => watchers.has("/map/lib"));
  expect(watchers.has("/map/src")).toBe(false);
  subscription.unsubscribe();
  expect(watchers.has("/map/lib")).toBe(false);
});
