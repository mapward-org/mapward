import { expect, test } from "vitest";
import type { AppBridge, BridgeClient } from "@mapward/core";
import { ViewStates } from "./view-state.ts";

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Раскрытые папки и прочие настройки смотрящего переживают уход вида с экрана: вернулся — они
 * сразу прежние, а не начальные на кадр, пока хранилище отвечает заново.
 */
test("прочитанное состояние вида помнится и без подписки", async () => {
  let asked = 0;
  const bridge = {
    getViewState: async () => {
      asked += 1;
      return ["src"];
    },
  } as unknown as BridgeClient<AppBridge>;
  const slot = new ViewStates(bridge).slot<string[]>("views:tree:x", []);

  const shown = slot.changed$.subscribe();
  await settled();
  expect(slot.value).toEqual(["src"]);
  shown.unsubscribe();

  expect(slot.value).toEqual(["src"]);
  const again = slot.changed$.subscribe();
  expect(slot.value).toEqual(["src"]);
  await settled();
  expect(asked).toBe(2);
  again.unsubscribe();
});

/** Страница снимка: перекрытия на снимок, а запись — только в её память. */
test("снимок перекрывает состояние вида и не пишет в хранилище человека", async () => {
  const written: unknown[] = [];
  const bridge = {
    getViewState: async () => ["src"],
    setViewState: async (value: unknown) => {
      written.push(value);
    },
  } as unknown as BridgeClient<AppBridge>;
  const views = new ViewStates(bridge, { viewState: { "views:tree:a": ["lib"] }, expand: "all" });

  const given = views.slot<string[] | "all">("views:tree:a", [], { value: "all" });
  const all = views.slot<string[] | "all">("views:tree:b", [], { value: "all" });
  const plain = views.slot<number>("zoom", 1);
  const shown = [given, all, plain].map((slot) => slot.changed$.subscribe());
  await settled();

  // Явное перекрытие сильнее «всё раскрыто»; без `expanded` — значение человека.
  expect(given.value).toEqual(["lib"]);
  expect(all.value).toBe("all");
  expect(plain.value).toEqual(["src"]);

  all.set(["one"]);
  expect(all.value).toEqual(["one"]);
  expect(written).toEqual([]);
  for (const one of shown) one.unsubscribe();

  // Обычная страница пишет человеку, как раньше.
  const own = new ViewStates(bridge).slot<number>("zoom", 1);
  own.set(2);
  expect(written).toEqual([{ key: "zoom", value: 2 }]);
});
