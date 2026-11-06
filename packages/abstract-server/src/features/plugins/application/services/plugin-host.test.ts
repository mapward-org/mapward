import {
  BehaviorSubject,
  defer,
  firstValueFrom,
  map as mapStream,
  NEVER,
  of,
  startWith,
  throwError,
  toArray,
} from "rxjs";
import { expect, test } from "vitest";
import { findObject } from "@mapward/core";
import type { LogLine, MapObject } from "@mapward/core";
import { definePlugin, runPlugin } from "@mapward/plugin";
import type { PlatformMessage, PluginDefinition, PluginMessage } from "@mapward/plugin";
import type {
  FileEntry,
  FileReader,
  FileWriter,
  PluginProcess,
  PluginProcessPort,
  TimersPort,
  TrustPort,
} from "../../../../ports/index.ts";
import type { BuildPlugin } from "../use-cases/build-plugin.ts";
import { InstallPlugin } from "../use-cases/install-plugin.ts";
import type { PluginsLogs, PluginsMapEdits } from "../../ports.ts";
import { PluginHost } from "./plugin-host.ts";

/** Таймеры среды: у пакета их типов нет, а тесту они нужны. */
const { setTimeout, queueMicrotask } = globalThis as unknown as {
  setTimeout: (run: () => void, ms: number) => unknown;
  queueMicrotask: (run: () => void) => void;
};

const REF = { mapPath: "/map", basePath: "/", name: "карта" };

const object = (address: string, name: string, children: MapObject[] = []): MapObject =>
  ({
    address,
    name,
    path: `/map/${name}`,
    props: { name },
    isGroup: false,
    children,
  }) as unknown as MapObject;

/**
 * Процесс в памяти: «скрипт» — ключ плагина в реестре, а сам плагин крутится тем же рантаймом,
 * что в настоящем процессе. Платформа разницы не видит — канал тот же.
 */
function processes(registry: Record<string, PluginDefinition>) {
  const started: string[] = [];
  const port: PluginProcessPort = {
    start({ script }) {
      started.push(script);
      const lines: ((line: string) => void)[] = [];
      const exits: ((code: number | null) => void)[] = [];
      let toPlugin: ((message: PlatformMessage) => void) | undefined;
      let alive = true;
      const exit = (code: number | null) => {
        if (!alive) return;
        alive = false;
        for (const listener of exits) listener(code);
      };
      const definition = registry[script];
      if (!definition) throw new Error(`нет плагина ${script}`);
      runPlugin(definition, {
        send: (message: PluginMessage) => {
          if (alive)
            queueMicrotask(() => lines.forEach((listener) => listener(JSON.stringify(message))));
        },
        onMessage: (handler) => {
          toPlugin = handler;
        },
        log: () => {},
        exit: (code) => queueMicrotask(() => exit(code)),
      });
      const process: PluginProcess = {
        send: (line) => {
          if (alive) toPlugin?.(JSON.parse(line) as PlatformMessage);
        },
        onLine: (listener) => lines.push(listener),
        onLog: () => {},
        onExit: (listener) => exits.push(listener),
        kill: () => exit(null),
      };
      return process;
    },
  };
  return { port, started };
}

/** Таймеры по кнопке: простой и пауза остановки срабатывают, когда тест скажет. */
function timers() {
  const pending: { run: () => void; alive: boolean }[] = [];
  const port: TimersPort = {
    every: () => () => {},
    after: (_ms, run) => {
      const entry = { run, alive: true };
      pending.push(entry);
      return () => {
        entry.alive = false;
      };
    },
  };
  return {
    port,
    fire: () => {
      for (const entry of pending.splice(0)) if (entry.alive) entry.run();
    },
  };
}

/** Встроенных нет — доставлять нечего. */
const NO_INSTALL = new InstallPlugin(disk().port, undefined, {});

function host(
  registry: Record<string, PluginDefinition>,
  root: MapObject = object("mapward://", "map"),
  options: {
    install?: InstallPlugin;
    trust?: TrustPort;
    build?: BuildPlugin;
    edits?: PluginsMapEdits;
    logs?: PluginsLogs;
  } = {},
) {
  const map = new BehaviorSubject(root);
  const proc = processes(registry);
  const time = timers();
  const watchers: ((path: string) => void)[] = [];
  const clock = { at: Date.parse("2026-10-29T00:00:00Z") };
  const build =
    options.build ??
    ({
      entry: async (plugin: string) => `${plugin}/index.ts`,
      run: async (_ref: unknown, plugin: string) => ({ script: plugin }),
    } as unknown as BuildPlugin);
  const plugins = new PluginHost(
    // Модель по адресу, как у сервера: без детей или с детьми без внуков, и поддерево целиком.
    {
      object$: (_ref, address, shape) =>
        map.pipe(
          mapStream((top) => {
            const found = findObject(top, address);
            if (!found) return undefined;
            const children =
              shape === "children"
                ? found.children.map((child) => ({ ...child, children: [] }))
                : [];
            return { ...found, children };
          }),
        ),
      subtree$: (_ref, address) => map.pipe(mapStream((top) => findObject(top, address))),
    },
    build,
    options.install ?? NO_INSTALL,
    {
      watch: (_root, onChange) => {
        watchers.push(onChange);
        return () => {};
      },
    },
    time.port,
    { now: () => new Date(clock.at).toISOString() },
    { vars: () => ({}) },
    proc.port,
    options.trust,
    undefined,
    undefined,
    options.edits,
    options.logs,
  );
  return { plugins, map, started: proc.started, time, watchers, clock };
}

test("вызов поднимает процесс, ответ приходит потоком, процесс один на плагин", async () => {
  const { plugins, started } = host({
    "/map/_plugins/hello": definePlugin({
      methods: { hello: { run: (args: { name: string }) => of(`привет, ${args.name}`) } },
    }),
  });

  const first = await firstValueFrom(
    plugins.call(REF, "/map/_plugins/hello", "hello", { name: "мир" }),
  );
  const second = await firstValueFrom(
    plugins.call(REF, "/map/_plugins/hello", "hello", { name: "ещё" }),
  );

  expect([first, second]).toEqual(["привет, мир", "привет, ещё"]);
  expect(started).toEqual(["/map/_plugins/hello"]);
});

test("модель карты плагин видит через ctx.object — вместе с изменениями", async () => {
  const core = object("mapward://core", "core");
  const { plugins, map } = host(
    {
      "/p": definePlugin({
        methods: {
          name: {
            run: (args: { address: string }, ctx) =>
              ctx.object(args.address).pipe(mapStream((found) => found?.props.name)),
          },
        },
      }),
    },
    object("mapward://", "map", [core]),
  );

  const seen: unknown[] = [];
  const subscription = plugins
    .call(REF, "/p", "name", { address: "mapward://core" })
    .subscribe((value) => seen.push(value));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
  map.next(object("mapward://", "map", [{ ...core, props: { name: "ядро" } }]));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
  subscription.unsubscribe();

  expect(seen).toEqual(["core", "ядро"]);
});

test("ctx.tree отдаёт поддерево целиком и молчит, пока под адресом ничего не поменялось", async () => {
  const leaf = object("mapward://core/model", "model");
  const core = object("mapward://core", "core", [leaf]);
  const docs = object("mapward://docs", "docs");
  const { plugins, map } = host(
    {
      "/p": definePlugin({
        methods: {
          tree: {
            run: (args: { address: string }, ctx) =>
              ctx
                .tree(args.address, Infinity)
                .pipe(mapStream((found) => found?.children.map((child) => child.name))),
          },
        },
      }),
    },
    object("mapward://", "map", [core, docs]),
  );

  const seen: unknown[] = [];
  const subscription = plugins
    .call(REF, "/p", "tree", { address: "mapward://core" })
    .subscribe((value) => seen.push(value));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
  // Соседа поменяли — поддерево то же, тем же объектом: плагину сказать нечего.
  map.next(object("mapward://", "map", [core, { ...docs, props: { name: "доки" } }]));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
  map.next(object("mapward://", "map", [{ ...core, children: [leaf, docs] }]));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
  subscription.unsubscribe();

  expect(seen).toEqual([["model"], ["model", "docs"]]);
});

test("плагин зовёт плагин через платформу: процесс второго поднимается сам", async () => {
  const { plugins, started } = host({
    "/a": definePlugin({
      methods: {
        twice: {
          run: (args: { n: number }, ctx) =>
            ctx
              .plugin("/b")
              .call<number>("double", args)
              .pipe(mapStream((value) => value * 2)),
        },
      },
    }),
    "/b": definePlugin({ methods: { double: { run: (args: { n: number }) => of(args.n * 2) } } }),
  });

  const values = await firstValueFrom(plugins.call(REF, "/a", "twice", { n: 3 }).pipe(toArray()));

  expect(values).toEqual([12]);
  expect(started).toEqual(["/a", "/b"]);
});

test("ошибка метода и редактор без редактора — отказ, а не тишина", async () => {
  const { plugins } = host({
    "/p": definePlugin({
      methods: {
        broken: { run: () => throwError(() => new Error("сломалось")) },
        open: { run: (_args: unknown, ctx) => defer(() => ctx.vscode.openFile("/a.ts")) },
      },
    }),
  });

  await expect(firstValueFrom(plugins.call(REF, "/p", "broken", {}))).rejects.toThrow("сломалось");
  await expect(firstValueFrom(plugins.call(REF, "/p", "open", {}))).rejects.toThrow(
    /редактора нет/,
  );
});

test("правка кода — перезапуск, а живая подписка переезжает в новый процесс", async () => {
  let generation = 0;
  const { plugins, started, watchers, time, clock } = host({
    "/p": definePlugin({
      init: () => {
        generation += 1;
      },
      methods: {
        live: {
          run: () => NEVER.pipe(startWith(generation)),
        },
      },
    }),
  });

  const seen: unknown[] = [];
  const subscription = plugins.call(REF, "/p", "live", {}).subscribe((value) => seen.push(value));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
  for (const watcher of watchers) watcher("/p/index.ts");
  // Перезапуск — по тишине после правки.
  clock.at += 1_000;
  time.fire();
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 10));
  subscription.unsubscribe();

  expect(seen).toEqual([1, 2]);
  expect(started).toEqual(["/p", "/p"]);
});

test("самоописание приходит с рукопожатия", async () => {
  const { plugins } = host({
    "/p": definePlugin({
      description: "файлы",
      methods: { tree: { kind: "query", description: "дерево", run: () => of([]) } },
    }),
  });

  expect(await plugins.describe(REF, "/p")).toEqual({
    description: "файлы",
    activation: {},
    methods: { tree: { kind: "query", description: "дерево" } },
  });
});

/** Диск в памяти для установки: папки видны по путям файлов под ними. */
function disk() {
  const files = new Map<string, string>();
  const port: FileReader & FileWriter = {
    read: async (path) => files.get(path),
    list: async (dir) => {
      const entries = new Map<string, FileEntry>();
      for (const path of files.keys()) {
        if (!path.startsWith(`${dir}/`)) continue;
        const [name = ""] = path.slice(dir.length + 1).split("/");
        entries.set(name, { name, isDirectory: true });
      }
      return [...entries.values()];
    },
    write: async (path, text) => {
      files.set(path, text);
    },
    remove: async (path) => {
      files.delete(path);
    },
  };
  return { files, port };
}

test("встроенного в _plugins/<имя> нет — хост копирует его, доверенным, и потом поднимает", async () => {
  const { files, port } = disk();
  const order: string[] = [];
  const granted: string[] = [];
  const trust: TrustPort = {
    allow: async ({ plugin }) => {
      order.push(`allow ${plugin}`);
      return granted.includes(plugin);
    },
    grant: async ({ plugin }) => {
      order.push(`grant ${plugin}`);
      granted.push(plugin);
    },
  };
  // Доверие у установки то же, что у хоста: скопированное помечается там же, где проверяется.
  const install = new InstallPlugin(port, trust, { hello: { "index.ts": "// встроенный" } });
  const { plugins, started } = host(
    { "/map/_plugins/hello": definePlugin({ methods: { hi: { run: () => of("привет") } } }) },
    undefined,
    { install, trust },
  );

  expect(await firstValueFrom(plugins.call(REF, "/map/_plugins/hello", "hi", {}))).toBe("привет");
  expect(files.get("/map/_plugins/hello/index.ts")).toBe("// встроенный");
  expect(order).toEqual(["grant /map/_plugins/hello", "allow /map/_plugins/hello"]);
  expect(started).toEqual(["/map/_plugins/hello"]);

  // Копия уже есть — второй раз не копируется, даже если её поправили.
  files.set("/map/_plugins/hello/index.ts", "// правка");
  await plugins.stopAll();
  expect(await firstValueFrom(plugins.call(REF, "/map/_plugins/hello", "hi", {}))).toBe("привет");
  expect(files.get("/map/_plugins/hello/index.ts")).toBe("// правка");
  expect(order.filter((step) => step.startsWith("grant"))).toHaveLength(1);
});

test("плагина нет и он не встроенный — отказ с перечнем встроенных", async () => {
  const install = new InstallPlugin(disk().port, undefined, { files: {}, navigation: {} });
  const { plugins } = host({}, undefined, {
    install,
    // Сборка подставная: входа нет ни у какого плагина.
    build: { entry: async () => undefined } as unknown as BuildPlugin,
  });

  await expect(plugins.describe(REF, "/map/_plugins/nope")).rejects.toThrow(
    /плагина \/map\/_plugins\/nope нет.*files, navigation/,
  );
});

/** Ответ правки карты платформы: перенос `a` в `b`. */
const movedA = (id: string) => ({
  ok: true as const,
  id,
  touched: [],
  created: [],
  moves: [{ from: "mapward://a", to: "mapward://b/a" }],
  copies: [],
  results: [],
});

test("ctx.editMap идёт в правку карты платформы, отмена — по номеру пачки", async () => {
  const asked: unknown[] = [];
  const done = movedA;
  const { plugins } = host(
    {
      "/p": definePlugin({
        methods: {
          move: {
            kind: "mutation",
            run: (_args: unknown, ctx) =>
              defer(async () => {
                const moved = await ctx.editMap([
                  { op: "move", object: "mapward://a", parent: "mapward://b" },
                ]);
                const undone = moved.ok ? await ctx.undoEdit(moved.id) : moved;
                return { moved, undone };
              }),
          },
        },
      }),
    },
    object("mapward://", "map"),
    {
      edits: {
        edit: async (ref, ops) => {
          asked.push({ ref: ref.mapPath, ops });
          return done("7");
        },
        undo: async (_ref, id) => {
          asked.push({ undo: id });
          return done(id);
        },
        redo: async (_ref, id) => done(id),
      },
    },
  );

  const value = (await firstValueFrom(plugins.call(REF, "/p", "move", {}))) as {
    moved: { moves: unknown };
  };
  expect(value.moved.moves).toEqual([{ from: "mapward://a", to: "mapward://b/a" }]);
  expect(asked).toEqual([
    { ref: "/map", ops: [{ op: "move", object: "mapward://a", parent: "mapward://b" }] },
    { undo: "7" },
  ]);
});

/** Логи в памяти: строки по порядку, файл — имя папки плагина. */
function memoryLogs() {
  const lines: LogLine[] = [];
  const logs: PluginsLogs = {
    fileOf: (plugin) => plugin.split("/").pop() ?? plugin,
    write: (_mapPath, line) => lines.push(line),
    tail: (_mapPath, file, count) => lines.filter((line) => line.file === file).slice(-count),
  };
  return { logs, lines };
}

const settle = () => new Promise<void>((resolve) => setTimeout(() => resolve(), 10));

test("вызов пишет в лог плагина начало, ход и конец в своём трейсе; вложенный вызов — в трейсе родителя", async () => {
  const { logs, lines } = memoryLogs();
  const { plugins } = host(
    {
      "/p/outer": definePlugin({
        methods: {
          run: {
            run: (_args: unknown, ctx) => {
              ctx.log("иду к соседу");
              return ctx.plugin("/p/inner").call("run");
            },
          },
        },
      }),
      "/p/inner": definePlugin({
        methods: {
          run: {
            run: (_args: unknown, ctx) =>
              defer(() => {
                ctx.step("сосед");
                ctx.output(`трейс ${ctx.call?.trace ?? "нет"}`);
                ctx.log.error("ой");
                return of(1);
              }),
          },
        },
      }),
    },
    undefined,
    { logs },
  );

  const values = await firstValueFrom(
    plugins
      .call(REF, "/p/outer", "run", {}, { trace: "t1", object: "mapward://core" })
      .pipe(toArray()),
  );
  await settle();

  expect(values).toEqual([1]);
  const shown = lines.map((line) => [line.file, line.kind, line.text ?? line.status ?? ""]);
  expect(shown).toEqual([
    ["outer", "call-start", ""],
    ["outer", "log", "иду к соседу"],
    ["inner", "call-start", ""],
    ["inner", "step", "сосед"],
    // Плагин знает свой трейс: его отдают процессам переменной окружения.
    ["inner", "out", "трейс t1"],
    ["inner", "error", "ой"],
    ["inner", "call-end", "success"],
    ["outer", "call-end", "success"],
  ]);
  // Все строки — в одном трейсе и на одном объекте; вложенный вызов знает родителя.
  expect(new Set(lines.map((line) => line.trace))).toEqual(new Set(["t1"]));
  expect(lines.every((line) => line.object === "mapward://core")).toBe(true);
  const outer = lines.find((line) => line.file === "outer" && line.kind === "call-start");
  const inner = lines.find((line) => line.file === "inner" && line.kind === "call-start");
  expect(inner?.parent).toBe(outer?.call);
  expect(outer?.parent).toBeUndefined();
});

test("вызов без трейса заводит свой; отмена трейса снимает все его вызовы и будит ctx.signal", async () => {
  const { logs, lines } = memoryLogs();
  const aborted: string[] = [];
  const { plugins } = host(
    {
      "/p/wait": definePlugin({
        methods: {
          wait: {
            run: (args: { name: string }, ctx) => {
              ctx.signal.addEventListener("abort", () => aborted.push(args.name));
              return NEVER;
            },
          },
        },
      }),
    },
    undefined,
    { logs },
  );

  const errors: string[] = [];
  const watch = (name: string, trace?: string) =>
    plugins
      .call(REF, "/p/wait", "wait", { name }, trace === undefined ? undefined : { trace })
      .subscribe({ error: (error: Error) => errors.push(`${name}: ${error.message}`) });
  watch("первый", "t1");
  watch("второй", "t1");
  const other = watch("чужой");
  await settle();

  plugins.cancelTrace("t1");
  await settle();

  expect(errors.toSorted()).toEqual(["второй: остановлен", "первый: остановлен"]);
  expect(aborted.toSorted()).toEqual(["второй", "первый"]);
  const own = lines.find((line) => line.kind === "call-start" && line.trace !== "t1");
  expect(own?.trace).toMatch(/^t/);
  expect(
    lines.filter((line) => line.kind === "call-end").map((line) => [line.trace, line.status]),
  ).toEqual([
    ["t1", "stopped"],
    ["t1", "stopped"],
  ]);
  other.unsubscribe();
});
