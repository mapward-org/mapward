import { expect, test } from "vitest";
import { Observable, type Subscriber } from "rxjs";
import type { Run } from "@mapward/core";
import type { FilesPort } from "../../../ports/index.ts";
import type { MapRef } from "../../../kernel/map-ref.ts";
import { MapModel } from "../../map/index.ts";
import { RunStore } from "./run-store.ts";

/** Карта в памяти, куда можно и писать: прогоны ложатся на диск, и это проверяется. */
function memoryFiles(tree: Record<string, string>): FilesPort {
  return {
    read: (path) => Promise.resolve(tree[path]),
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
    watch: () => () => undefined,
  };
}

/** Вызов метода, как его видит платформа: аргументы и поток, которым тест отвечает сам. */
type Call = {
  plugin: string;
  method: string;
  args: unknown;
  sink: Subscriber<unknown>;
  stopped: boolean;
};

const MAP = "/map";
const ref: MapRef = { mapPath: MAP, basePath: "/repo", name: "Карта" };

const baseTree = (): Record<string, string> => ({
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  // Экшон со своей формой над `shell.steps`: данные формы доезжают до метода полем `inputs`.
  "/map/_actions/release/config.json": JSON.stringify({
    label: "Выпуск",
    inputs: {
      level: { type: "choice", options: ["patch", "minor"], required: true },
      dry: { type: "boolean" },
    },
    plugin: "/map/_plugins/shell",
    method: "steps",
    params: {
      steps: [
        { kind: "script", name: "сборка", command: "build ${{ inputs.level }}" },
        { kind: "script", name: "выпуск", command: "publish" },
      ],
    },
  }),
  // Экшон над методом: форма — схема метода без заданного в `params`.
  "/map/_actions/tag/config.json": JSON.stringify({
    label: "Метка",
    plugin: "../../tools",
    method: "tag",
    params: { repo: "core" },
  }),
});

/** Самоописание плагина `tools`: у метода `tag` три параметра, один задан экшоном. */
const TOOLS = {
  methods: {
    tag: {
      params: {
        type: "object",
        required: ["repo", "name"],
        properties: {
          repo: { type: "string" },
          name: { type: "string" },
          count: { type: "number" },
        },
      },
    },
  },
};

type Timers = { every: () => () => void; after: (ms: number, run: () => void) => () => void };

function store(
  tree: Record<string, string>,
  options: { timers?: Timers; activity?: ConstructorParameters<typeof RunStore>[5] } = {},
) {
  const files = memoryFiles(tree);
  const timers = options.timers ?? { every: () => () => {}, after: () => () => {} };
  const clock = { now: () => new Date().toISOString() };
  // У модели свои таймеры: её срок держать прочитанное не должен путаться с таймерами прогонов.
  const map = new MapModel(files, files, { every: () => () => {}, after: () => () => {} }, clock);
  const calls: Call[] = [];
  const runs = new RunStore(
    files,
    map,
    {
      describe: () => Promise.resolve(TOOLS),
      call: (_ref, plugin, method, args) =>
        new Observable<unknown>((sink) => {
          const call: Call = { plugin, method, args, sink, stopped: false };
          calls.push(call);
          return () => {
            call.stopped = true;
          };
        }),
    },
    timers,
    clock,
    options.activity,
  );
  return { runs, calls };
}

/** Дождаться, пока вызов дойдёт до плагина: старт асинхронный. */
async function called(calls: Call[], count = 1): Promise<Call> {
  // Микротасками: типов node в пакете нет, а прогон здесь весь на моках.
  // oxlint-disable-next-line no-await-in-loop
  for (let tick = 0; tick < 100 && calls.length < count; tick++) await Promise.resolve();
  const call = calls[count - 1];
  if (!call) throw new Error("плагин не позвали");
  return call;
}

test("fields are checked by the server: a missing required one means no run — decision 0038", async () => {
  const { runs, calls } = store(baseTree());

  const started = await runs.start(ref, "mapward://_actions/release", { level: "major" });

  expect(started.id).toBeUndefined();
  expect(started.errors?.level).toContain("patch");
  expect(calls).toHaveLength(0);
});

test("shell.steps: its messages become steps, the rest is the result", async () => {
  const tree = baseTree();
  const { runs, calls } = store(tree);

  const started = await runs.start(ref, "mapward://_actions/release", { level: "minor" }, "cli");
  const call = await called(calls);

  expect(call.plugin).toBe("/map/_plugins/shell");
  expect(call.method).toBe("steps");
  // Форма доезжает до плагина полем `inputs`, конфиг — параметрами.
  expect(call.args).toMatchObject({
    steps: [
      { kind: "script", name: "сборка", command: "build ${{ inputs.level }}" },
      { kind: "script", name: "выпуск", command: "publish" },
    ],
    inputs: { level: "minor", dry: false },
  });

  call.sink.next({ progress: "step", name: "сборка" });
  call.sink.next({ progress: "out", text: "собрано" });
  call.sink.next({ progress: "step", name: "выпуск" });
  call.sink.next({ progress: "log", text: "публикую" });
  call.sink.next({ code: 0 });
  call.sink.complete();
  const run = (await runs.wait(MAP, String(started.id))) as Run;

  expect(run.status).toBe("success");
  expect(run.source).toBe("cli");
  expect(run.steps.map((step) => [step.name, step.status])).toEqual([
    ["сборка", "success"],
    ["выпуск", "success"],
  ]);
  expect(run.steps[0]?.output).toBe("собрано\n");
  expect(run.steps[1]?.log).toBe("публикую\n");
  expect(run.result).toEqual({ code: 0 });

  // Прогон лёг на диск карты, а папка сама себя прячет от git.
  expect(tree["/map/.mapward/.gitignore"]).toBe("*\n");
  const saved = JSON.parse(tree["/map/.mapward/runs/_root.json"] ?? "[]") as Run[];
  expect(saved.map((entry) => entry.id)).toEqual([started.id]);
});

test("a method that fails fails the run with its message", async () => {
  const { runs, calls } = store(baseTree());

  const started = await runs.start(ref, "mapward://_actions/release", { level: "patch" });
  const call = await called(calls);
  call.sink.next({ progress: "step", name: "сборка" });
  call.sink.error(new Error("упало"));
  const run = (await runs.wait(MAP, String(started.id))) as Run;

  expect(run.status).toBe("failure");
  expect(run.error).toBe("упало");
  expect(run.steps.map((step) => [step.status, step.log])).toEqual([["failure", "упало"]]);
});

test("the form of an action over a method is the method schema minus its params", async () => {
  const { runs, calls } = store(baseTree());

  const missing = await runs.start(ref, "mapward://_actions/tag", {});
  expect(missing.errors).toEqual({ name: "обязательное поле" });
  // Заданное экшоном формой не перебивается: такого поля в форме нет.
  const clash = await runs.start(ref, "mapward://_actions/tag", { name: "v1", repo: "x" });
  expect(clash.errors).toEqual({ repo: "у экшона нет такого поля" });
  expect(calls).toHaveLength(0);

  const started = await runs.start(ref, "mapward://_actions/tag", { name: "v1", count: "2" });
  const call = await called(calls);
  // Путь плагина — от папки `config.json`; данные формы — рядом с заданными параметрами.
  expect(call.plugin).toBe("/map/tools");
  expect(call.args).toEqual({ repo: "core", name: "v1", count: 2 });

  call.sink.next({ progress: "out", text: "готово" });
  call.sink.complete();
  const run = (await runs.wait(MAP, String(started.id))) as Run;
  // Метод шагов не назвал — шаг один, плагином и методом.
  expect(run.steps.map((step) => [step.name, step.output])).toEqual([["tools.tag", "готово\n"]]);
});

test("runs of one action go in parallel, and stopping one unsubscribes from its call", async () => {
  const { runs, calls } = store(baseTree());

  const first = await runs.start(ref, "mapward://_actions/release", { level: "patch" });
  const second = await runs.start(ref, "mapward://_actions/release", { level: "minor" });
  expect(first.id).not.toBe(second.id);
  const a = await called(calls, 1);
  const b = await called(calls, 2);

  runs.stop(MAP, String(first.id));
  b.sink.complete();

  const [one, two] = await Promise.all([
    runs.wait(MAP, String(first.id)),
    runs.wait(MAP, String(second.id)),
  ]);
  expect(a.stopped).toBe(true);
  expect(one?.status).toBe("stopped");
  expect(two?.status).toBe("success");
});

test("a run recorded as running before a restart comes back stopped", async () => {
  const tree = baseTree();
  tree["/map/.mapward/runs/_root.json"] = JSON.stringify([
    {
      id: "old",
      kind: "action",
      target: "mapward://_actions/release",
      object: "mapward://",
      label: "Выпуск",
      source: "ui",
      status: "running",
      startedAt: "2026-09-01T00:00:00.000Z",
      steps: [],
    },
  ]);
  const { runs } = store(tree);

  const list = await new Promise<Run[]>((resolve) => {
    const subscription = runs.watch(MAP, "mapward://").subscribe((value) => {
      if (value.length === 0) return;
      subscription.unsubscribe();
      resolve(value);
    });
  });

  expect(list[0]?.status).toBe("stopped");
});

/**
 * Лог идущего шага растёт по ходу: вывод копится и уходит подписчику пачкой, по таймеру, а не
 * на каждой строке. Экшон при этом виден в ленте — запущен и упал.
 */
test("a running step log grows before the step ends, and the feed sees the action", async () => {
  const flushes: (() => void)[] = [];
  const feed: string[] = [];
  const { runs, calls } = store(baseTree(), {
    timers: {
      every: () => () => {},
      after: (_ms: number, run: () => void) => (flushes.push(run), () => {}),
    },
    activity: {
      actionStarted: (turn) => feed.push(`идёт ${turn.label} ${turn.object}`),
      actionEnded: (turn, failed) => feed.push(`${failed ? "упал" : "кончился"} ${turn.label}`),
    },
  });
  const seen: Run[][] = [];
  const subscription = runs.watch(MAP, "mapward://").subscribe((list) => seen.push(list));

  const started = await runs.start(ref, "mapward://_actions/release", { level: "patch" });
  expect(feed).toEqual(["идёт Выпуск Карта"]);
  const call = await called(calls);
  call.sink.next({ progress: "log", text: "→ Read a.ts" });
  call.sink.next({ progress: "log", text: "→ Bash pnpm test" });
  // Две строки — одна пачка: таймер заведён один раз.
  expect(flushes).toHaveLength(1);
  const before = seen.length;
  flushes[0]?.();
  expect(seen.length).toBe(before + 1);
  expect(seen.at(-1)?.[0]?.steps[0]).toMatchObject({
    status: "running",
    log: "→ Read a.ts\n→ Bash pnpm test\n",
  });

  call.sink.error(new Error("агент упал"));
  await runs.wait(MAP, String(started.id));
  expect(feed).toEqual(["идёт Выпуск Карта", "упал Выпуск"]);
  subscription.unsubscribe();
});
