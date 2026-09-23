import { expect, test } from "vitest";
import type { Run } from "@mapward/core";
import type { FilesPort, ServerPorts } from "../../../ports/index.ts";
import { readMap } from "../../map-object/application/use-cases/read-map.ts";
import { createRunStore, type MapRef } from "./run-store.ts";

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

type Calls = { shell: { command: string; env: Record<string, unknown>; input?: string }[] };

function fakePorts(
  tree: Record<string, string>,
  calls: Calls,
  agent: ServerPorts["agent"] = { run: () => Promise.resolve({ stdout: "готово", stderr: "" }) },
): ServerPorts {
  return {
    files: memoryFiles(tree),
    shell: {
      run: () => Promise.resolve({ stdout: "", stderr: "" }),
      pipe: (command, options) => {
        calls.shell.push({ command, env: options.env, input: options.input });
        if (command === "fail") return Promise.reject(new Error("упало"));
        return Promise.resolve({ stdout: `вывод ${command}`, stderr: "" });
      },
    },
    agent,
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

const baseTree = (): Record<string, string> => ({
  "/map/_index.json": JSON.stringify({ name: "Карта" }),
  "/map/_actions/release/config.json": JSON.stringify({
    label: "Выпуск",
    inputs: {
      level: { type: "choice", options: ["patch", "minor"], required: true },
      dry: { type: "boolean" },
    },
    runners: [
      { kind: "script", name: "сборка", run: "build ${{ inputs.level }}" },
      { kind: "script", name: "выпуск", run: "publish" },
    ],
    refreshes: ["version"],
  }),
  "/map/_actions/broken/config.json": JSON.stringify({
    runners: [
      { kind: "script", run: "fail" },
      { kind: "script", run: "never" },
    ],
  }),
  "/map/_actions/ask/config.json": JSON.stringify({
    inputs: { topic: { required: true } },
    runners: [
      { kind: "prompt", prompt: "расскажи про ${{ inputs.topic }}", permissions: "bypass" },
    ],
  }),
});

function store(tree: Record<string, string>, calls: Calls, agent?: ServerPorts["agent"]) {
  const refreshed: string[] = [];
  const ports = fakePorts(tree, calls, agent);
  const runs = createRunStore(ports, {
    readMap: (map) => readMap(ports.files, map.mapPath, map.basePath, map.name),
    runMetric: (_, address) => {
      refreshed.push(address);
      return Promise.resolve();
    },
  });
  return { runs, refreshed };
}

test("fields are checked by the server: a missing required one means no run — decision 0038", async () => {
  const calls: Calls = { shell: [] };
  const { runs } = store(baseTree(), calls);

  const started = await runs.start(ref, "mapward://_actions/release", { level: "major" });

  expect(started.id).toBeUndefined();
  expect(started.errors?.level).toContain("patch");
  expect(calls.shell).toHaveLength(0);
});

test("a run goes step by step, gets the form, and refreshes its metrics after success", async () => {
  const tree = baseTree();
  const calls: Calls = { shell: [] };
  const { runs, refreshed } = store(tree, calls);

  const started = await runs.start(ref, "mapward://_actions/release", { level: "minor" }, "cli");
  const run = (await runs.wait(MAP, String(started.id))) as Run;

  expect(run.status).toBe("success");
  expect(run.source).toBe("cli");
  expect(run.steps.map((step) => [step.name, step.status])).toEqual([
    ["сборка", "success"],
    ["выпуск", "success"],
  ]);
  expect(run.steps[0]?.output).toBe("вывод build minor");
  // Форма доезжает до скрипта и входом, и переменными.
  expect(calls.shell[0]?.input).toBe(JSON.stringify({ level: "minor", dry: false }));
  expect(calls.shell[0]?.env.MAPWARD_INPUT_LEVEL).toBe("minor");
  expect(refreshed).toEqual(["mapward://_metrics/version"]);

  // Прогон лёг на диск карты, а папка сама себя прячет от git.
  expect(tree["/map/.mapward/.gitignore"]).toBe("*\n");
  const saved = JSON.parse(tree["/map/.mapward/runs/_root.json"] ?? "[]") as Run[];
  expect(saved.map((entry) => entry.id)).toEqual([started.id]);
});

test("a failed step stops the run, and nothing is refreshed", async () => {
  const calls: Calls = { shell: [] };
  const { runs, refreshed } = store(baseTree(), calls);

  const started = await runs.start(ref, "mapward://_actions/broken");
  const run = (await runs.wait(MAP, String(started.id))) as Run;

  expect(run.status).toBe("failure");
  expect(run.error).toBe("упало");
  expect(run.steps.map((step) => step.status)).toEqual(["failure"]);
  expect(calls.shell.map((call) => call.command)).toEqual(["fail"]);
  expect(refreshed).toEqual([]);
});

test("a prompt runner gets the form in its text and the permissions it declared", async () => {
  const seen: { prompt: string; permissions?: unknown }[] = [];
  const agent: ServerPorts["agent"] = {
    run: (params) => {
      seen.push({ prompt: params.prompt, permissions: params.permissions });
      return Promise.resolve({ stdout: "рассказал", stderr: "" });
    },
  };
  const { runs } = store(baseTree(), { shell: [] }, agent);

  const started = await runs.start(ref, "mapward://_actions/ask", { topic: "карты" });
  await runs.wait(MAP, String(started.id));

  expect(seen[0]?.prompt).toContain("расскажи про карты");
  expect(seen[0]?.permissions).toBe("bypass");
});

test("runs of one action go in parallel and each can be stopped on its own", async () => {
  const pending: (() => void)[] = [];
  const agent: ServerPorts["agent"] = {
    run: (params) =>
      new Promise((resolve, reject) => {
        params.cancel?.onCancel(() => reject(new Error("снят")));
        pending.push(() => resolve({ stdout: "ok", stderr: "" }));
      }),
  };
  const { runs } = store(baseTree(), { shell: [] }, agent);

  const first = await runs.start(ref, "mapward://_actions/ask", { topic: "раз" });
  const second = await runs.start(ref, "mapward://_actions/ask", { topic: "два" });
  expect(first.id).not.toBe(second.id);

  runs.stop(MAP, String(first.id));
  // Дождаться, пока второй дойдёт до агента, и отпустить его.
  // Микротасками: типов node в пакете нет, а прогон здесь весь на моках.
  for (let tick = 0; tick < 100 && pending.length < 2; tick++) await Promise.resolve();
  for (const release of pending) release();

  const [a, b] = await Promise.all([
    runs.wait(MAP, String(first.id)),
    runs.wait(MAP, String(second.id)),
  ]);
  expect(a?.status).toBe("stopped");
  expect(b?.status).toBe("success");
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
  const { runs } = store(tree, { shell: [] });

  const list = await new Promise<Run[]>((resolve) => {
    const subscription = runs.watch(MAP, "mapward://").subscribe((value) => {
      if (value.length === 0) return;
      subscription.unsubscribe();
      resolve(value);
    });
  });

  expect(list[0]?.status).toBe("stopped");
});
