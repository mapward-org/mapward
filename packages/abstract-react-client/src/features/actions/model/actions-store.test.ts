import { NEVER } from "rxjs";
import { expect, test } from "vitest";
import type { ActionConfig, MapAction, MapObject } from "@mapward/core";
import { ActionsStore } from "./actions-store.ts";
import { Launcher, type LaunchRunner } from "./launcher.ts";

/**
 * `useAction` компонента — `handle` стора экшонов: тот же запуск, что из шапки, число идущих
 * прогонов и честное «нет» только тогда, когда сервер его сказал.
 */

const action = (owner: string, key: string, config: Partial<ActionConfig> = {}): MapAction => ({
  key,
  address: `${owner}/_actions/${key}`,
  configPath: `/map/${key}/config.json`,
  layers: [],
  config: { label: `Экшон ${key}`, inputs: {}, ...config } as ActionConfig,
});

const deploy = action("mapward://app", "deploy", {
  description: "выкатить",
  inputs: { env: {}, force: { type: "boolean" } },
});
const app = { address: "mapward://app", actions: [deploy] } as unknown as MapObject;

const lint = action("mapward://tools", "lint");
const tools = { address: "mapward://tools", actions: [lint] } as unknown as MapObject;

function store(known: Record<string, MapObject | "missing"> = {}, running = {}) {
  const sent: { action: string; inputs: Record<string, unknown>; source: string }[] = [];
  const runner: LaunchRunner = {
    form: async () => ({ fields: {} }),
    run: async (address, inputs, source) => {
      sent.push({ action: address, inputs, source });
      return { id: "1" } as never;
    },
  };
  const counts = running as Record<string, number>;
  const actions = new ActionsStore(
    new Launcher(runner),
    { changed$: NEVER, running: (address) => counts[address] ?? 0 },
    {
      object: (address) => {
        const one = known[address];
        return one === "missing" ? undefined : one;
      },
      feed: () => ({ changed$: NEVER }),
      missing: (address) => known[address] === "missing",
    },
  );
  return { actions, sent };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("экшон по ключу своего объекта: подпись, описание и запуск тем же путём", async () => {
  const { actions, sent } = store();
  const handle = actions.handle(app, { run: "deploy", inputs: { env: "stage" } });

  expect(handle).toMatchObject({
    label: "Экшон deploy",
    description: "выкатить",
    missing: false,
    running: 0,
  });

  // Значения запуска ложатся поверх тех, что даны хуку.
  handle.run({ force: true });
  await settled();
  expect(sent).toEqual([
    { action: deploy.address, inputs: { env: "stage", force: true }, source: "display" },
  ]);
});

test("сколько прогонов экшона идёт — у прогонов объекта", () => {
  const { actions } = store({}, { [deploy.address]: 2 });
  expect(actions.handle(app, { run: "deploy" }).running).toBe(2);
});

test("экшон чужого объекта по адресу находится, когда объект пришёл", async () => {
  const { actions, sent } = store({ "mapward://tools": tools });
  const handle = actions.handle(app, { run: lint.address });

  expect(handle.label).toBe("Экшон lint");
  expect(handle.missing).toBe(false);
  // Подписка вида — и на объект-владелец: он может прийти позже.
  expect(actions.source(lint.address)).toBeDefined();
  expect(actions.source("deploy")).toBeUndefined();

  handle.run();
  await settled();
  expect(sent.map((one) => one.action)).toEqual([lint.address]);
});

test("объект-владелец ещё в пути — «ещё не знаем», а не «нет»", async () => {
  const { actions, sent } = store();
  const handle = actions.handle(app, { run: lint.address });

  expect(handle).toMatchObject({ label: lint.address, missing: false, running: 0 });
  handle.run();
  await settled();
  expect(sent).toEqual([]);
});

test("нет экшона — так и говорится: ключа нет у объекта или сервер ответил, что объекта нет", () => {
  const { actions } = store({ "mapward://app": app, "mapward://tools": "missing" });

  expect(actions.handle(app, { run: "release" })).toMatchObject({
    label: "release",
    missing: true,
  });
  expect(actions.handle(app, { run: lint.address }).missing).toBe(true);
  expect(actions.handle(app, { run: "mapward://app/_actions/nope" }).missing).toBe(true);
});
