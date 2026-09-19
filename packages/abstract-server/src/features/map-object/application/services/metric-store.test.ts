import { expect, test } from "vitest";
import type { FilesPort, ServerPorts } from "../../../../ports/index.ts";
import { readMap } from "../use-cases/read-map.ts";
import { createMetricStore, type MapRef } from "./metric-store.ts";

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
    timers: { every: () => () => undefined },
    env: { vars: () => ({}) },
    capabilities: { terminals: false, openFile: false, ask: false },
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
