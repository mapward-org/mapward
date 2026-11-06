import { NEVER, Observable, of, Subject } from "rxjs";
import { expect, test } from "vitest";
import type { LogFilter, LogLine, MapObject, Run, TraceRef } from "@mapward/core";
import { TraceStore } from "./trace-store.ts";
import type { TracesActivityTurn, TracesLogs, TracesPlugins } from "../ports.ts";

const REF = { mapPath: "/map", basePath: "/", name: "карта" };

/** Объект с экшонами — как его отдаёт модель. */
const core = {
  address: "mapward://core",
  name: "core",
  path: "/map/core",
  props: {},
  isGroup: false,
  children: [],
  metrics: [],
  actions: [
    {
      key: "greet",
      address: "mapward://core/_actions/greet",
      config: {
        label: "Поздороваться",
        inputs: { name: { type: "string", required: true } },
        plugin: "/p/shell",
        method: "run",
        params: { command: "echo" },
      },
    },
    {
      key: "wait",
      address: "mapward://core/_actions/wait",
      config: { label: "Ждать", inputs: {}, plugin: "/p/shell", method: "wait" },
    },
  ],
} as unknown as MapObject;

/** Логи в памяти: пишутся сразу, поток — окно заново на каждую строку. */
function memoryLogs() {
  const lines: LogLine[] = [];
  const added = new Subject<void>();
  const pick = (filter: LogFilter) =>
    lines.filter(
      (line) =>
        (filter.trace === undefined || line.trace === filter.trace) &&
        (filter.object === undefined || line.object === filter.object),
    );
  const logs: TracesLogs = {
    write: (_mapPath, line) => {
      lines.push(line);
      added.next();
    },
    read: async (_mapPath, filter) => pick(filter),
    watch: (_mapPath, filter) =>
      new Observable<LogLine[]>((sink) => {
        sink.next(pick(filter));
        const subscription = added.subscribe(() => sink.next(pick(filter)));
        return () => subscription.unsubscribe();
      }),
  };
  return { logs, lines };
}

/**
 * Плагин, который пишет строки сам, как это делает хост: вызов в трейсе, вывод, конец. `wait`
 * не кончается никогда — его снимает только отмена.
 */
function fakePlugins(logs: TracesLogs) {
  let counter = 0;
  const cancelled: string[] = [];
  const plugins: TracesPlugins = {
    describe: async () => ({ methods: {} }),
    nextId: (prefix) => `${prefix}${++counter}`,
    cancelTrace: (trace) => cancelled.push(trace),
    call: (_ref, plugin, method, args, trace?: TraceRef) => {
      const base = {
        at: "2026-11-02T10:00:01.000Z",
        file: "shell",
        trace: trace?.trace ?? "?",
        call: "c1",
        plugin,
        method,
        ...(trace?.object === undefined ? {} : { object: trace.object }),
      };
      if (method === "wait") {
        logs.write("/map", { ...base, kind: "call-start" });
        return NEVER;
      }
      logs.write("/map", { ...base, kind: "call-start" });
      logs.write("/map", {
        ...base,
        kind: "out",
        text: `привет, ${String((args as { inputs?: { name?: string } }).inputs?.name)}`,
      });
      logs.write("/map", { ...base, kind: "call-end", status: "success" });
      return of({ code: 0 });
    },
  };
  return { plugins, cancelled };
}

function store() {
  const { logs, lines } = memoryLogs();
  const { plugins, cancelled } = fakePlugins(logs);
  const turns: string[] = [];
  const traces = new TraceStore(
    logs,
    { object: async (_ref, address) => (address === "mapward://core" ? core : undefined) },
    plugins,
    { now: () => "2026-11-02T10:00:02.000Z" },
    {
      actionStarted: (turn: TracesActivityTurn) => turns.push(`идёт ${turn.label}`),
      actionEnded: (turn: TracesActivityTurn, failed) =>
        turns.push(`${failed ? "упал" : "кончился"} ${turn.label}`),
    },
  );
  return { traces, lines, turns, cancelled };
}

test("экшон — трейс: начало и конец в логе, прогон собран из строк, лента знает", async () => {
  const { traces, lines, turns } = store();

  expect(await traces.start(REF, "mapward://core/_actions/greet", {}, "ui")).toEqual({
    errors: { name: "обязательное поле" },
  });
  // Поля не прошли — трейса нет.
  expect(lines).toEqual([]);

  const { id } = await traces.start(REF, "mapward://core/_actions/greet", { name: "мир" }, "mcp");
  const run = (await traces.wait("/map", String(id))) as Run;

  expect(run).toMatchObject({
    id,
    kind: "action",
    target: "mapward://core/_actions/greet",
    object: "mapward://core",
    label: "Поздороваться",
    source: "mcp",
    status: "success",
    inputs: { name: "мир" },
    result: { code: 0 },
  });
  expect(run.steps).toEqual([
    expect.objectContaining({ name: "shell.run", status: "success", output: "привет, мир\n" }),
  ]);
  expect(lines.filter((line) => line.file === "mapward").map((line) => line.kind)).toEqual([
    "trace-start",
    "trace-end",
  ]);
  expect(turns).toEqual(["идёт Поздороваться", "кончился Поздороваться"]);
});

test("остановка снимает трейс, его вызовы и экшон, запущенный внутри него", async () => {
  const { traces, cancelled } = store();
  const outer = await traces.start(REF, "mapward://core/_actions/wait", {}, "ui");
  // Агент экшона позвал run_action — новый прогон в трейсе того экшона.
  const inner = await traces.start(REF, "mapward://core/_actions/wait", {}, "mcp", outer.id);

  const watched: Run[][] = [];
  const subscription = traces
    .watch("/map", "mapward://core")
    .subscribe((runs) => watched.push(runs));
  expect(watched.at(-1)?.map((run) => run.status)).toEqual(["running", "running"]);

  traces.stop(String(outer.id));
  subscription.unsubscribe();

  expect(cancelled.toSorted()).toEqual([outer.id, inner.id].toSorted());
  const outerRun = await traces.find("/map", String(outer.id));
  const innerRun = await traces.find("/map", String(inner.id));
  expect(outerRun?.status).toBe("stopped");
  expect(innerRun?.status).toBe("stopped");
});

test("трейс без конца, которого нет среди идущих, прервался вместе с окном", async () => {
  const { traces, lines } = store();
  lines.push({
    at: "2026-11-01T10:00:00.000Z",
    kind: "trace-start",
    file: "mapward",
    trace: "old",
    traceKind: "action",
    object: "mapward://core",
    target: "mapward://core/_actions/wait",
    label: "Ждать",
    source: "ui",
  });

  const run = await traces.find("/map", "old");

  expect(run).toMatchObject({ status: "stopped", error: "прогон прервался вместе с окном" });
});

test("метрика — трейс до первого значения; вызов из интерфейса — без прогона", async () => {
  const { traces, lines } = store();
  const values: unknown[] = [];
  traces
    .metricCall(
      REF,
      "/p/shell",
      "run",
      { inputs: { name: "метрика" } },
      {
        object: "mapward://core",
        metric: "mapward://core/_metrics/files",
      },
    )
    .subscribe((value) => values.push(value));

  expect(values).toEqual([{ code: 0 }]);
  const runs = await new Promise<Run[]>((resolve) =>
    traces.watch("/map", "mapward://core").subscribe(resolve),
  );
  expect(runs).toEqual([
    expect.objectContaining({
      kind: "metric",
      target: "mapward://core/_metrics/files",
      status: "success",
    }),
  ]);
  const before = lines.length;
  const plain = traces.newTrace();
  expect(plain.trace).toMatch(/^t/);
  expect(lines.length).toBe(before);
});
