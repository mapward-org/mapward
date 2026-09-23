import { expect, test } from "vitest";
import type { MapMetric, MapObject, MetricConfig } from "@mapward/core";
import type { ServerPorts } from "../../../../ports/index.ts";
import { DisplaySchema } from "../../../displays/index.ts";
import { Executor } from "../../../execution/index.ts";
import { Builtins } from "../services/builtins.ts";
import { GitStatus } from "../services/git-status.ts";
import { MetricCache } from "../services/metric-cache.ts";
import type { Collected } from "../services/metric-cache.ts";
import { TransformMetric } from "./transform-metric.ts";

/** Трансформ, собранный так же, как в сборке сервера. */
function transform(
  ports: ServerPorts,
  metric: MapMetric,
  owner: MapObject,
  cwd: string,
  collected: Collected,
) {
  const { files, shell, agent, env, timers, clock } = ports;
  const builtins = new Builtins(new GitStatus(shell, files, env, timers, clock));
  return new TransformMetric(
    builtins,
    new MetricCache(files, files),
    new DisplaySchema(files),
    new Executor(shell, agent),
    env,
    clock,
  ).run(metric, owner, cwd, collected);
}

/**
 * Встроенный шаг проверяется сквозь `transform`: реестр и пайплайн сходятся именно здесь, и
 * позвать тело шага напрямую значило бы проверить чистую функцию, которая уже проверена.
 */
function fakePorts(shell: Partial<ServerPorts["shell"]> = {}): {
  ports: ServerPorts;
  written: Record<string, string>;
} {
  const written: Record<string, string> = {};

  const ports: ServerPorts = {
    files: {
      read: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      write: (path, text) => {
        written[path] = text;
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
      watch: () => () => undefined,
    },
    shell: {
      run: (command) =>
        command.startsWith("git rev-parse")
          ? Promise.resolve({ stdout: "/repo\n/repo/.git\n", stderr: "" })
          : Promise.resolve({ stdout: " M src/changed.ts\0?? src/new.ts\0", stderr: "" }),
      pipe: () => Promise.resolve({ stdout: "{}", stderr: "" }),
      ...shell,
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

  return { ports, written };
}

const metricOf = (config: MetricConfig): MapMetric => ({
  key: "files",
  address: "mapward://_metrics/files",
  configPath: "/map/_metrics/files/config.json",
  cachePath: "/map/_metrics/files",
  layers: [],
  config,
});

const owner = { name: "Карта", address: "mapward://", path: "/map" } as MapObject;

const collected = {
  updatedAt: "2026-09-20T00:00:00.000Z",
  ok: true,
  data: {
    children: [
      { label: "changed.ts", link: "/repo/src/changed.ts", isDir: false, children: [] },
      { label: "quiet.ts", link: "/repo/src/quiet.ts", isDir: false, children: [] },
    ],
  },
};

test("встроенный шаг зовётся по имени и метит узлы", async () => {
  const { ports } = fakePorts();
  const metric = metricOf({ transforms: [{ kind: "git-status" }], display: { kind: "tree" } });

  const result = await transform(ports, metric, owner, "/map", collected);

  const children = (result.data as { children: { git?: string }[] }).children;
  expect(result.ok).toBe(true);
  expect(children[0]?.git).toBe("M");
  expect(children[1]?.git).toBeUndefined();
});

test("упавший git не роняет метрику: данные проходят, причина уходит в лог", async () => {
  const { ports, written } = fakePorts({
    run: (command) =>
      command.startsWith("git rev-parse")
        ? Promise.resolve({ stdout: "/repo\n/repo/.git\n", stderr: "" })
        : Promise.reject(new Error("fatal: not a git repository")),
  });
  const metric = metricOf({ transforms: [{ kind: "git-status" }], display: { kind: "tree" } });

  const result = await transform(ports, metric, owner, "/map", collected);

  const children = (result.data as { children: { git?: string }[] }).children;
  expect(result.ok).toBe(true);
  expect(children[0]?.git).toBeUndefined();
  expect(written["/map/_metrics/files/transform.logs.json"]).toContain("not a git repository");
});

test("неизвестный вид шага по-прежнему ошибка", async () => {
  const { ports } = fakePorts();
  const metric = metricOf({ transforms: [{ kind: "выдуманный" }], display: { kind: "tree" } });

  const result = await transform(ports, metric, owner, "/map", collected);

  expect(result.ok).toBe(false);
});

test("кэш трансформа пишется как обычно — пометки в нём и лежат", async () => {
  const { ports, written } = fakePorts();
  const metric = metricOf({
    transforms: [{ kind: "git-status" }],
    transformsCache: true,
    display: { kind: "tree" },
  });

  await transform(ports, metric, owner, "/map", collected);

  // Комбинация шумная, и автор карты выключит её сам; молча подменять его настройку хуже.
  expect(written["/map/_metrics/files/transform.json"]).toContain('"git": "M"');
});
