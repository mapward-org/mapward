import { Subject } from "rxjs";
import { expect, test } from "vitest";
import { callId } from "../pure-model/call-key.ts";
import { CallMemory } from "./call-memory.ts";
import { QueryStore, StreamStore } from "./plugin-calls.ts";

/**
 * Запросы компонента по ключу — как react-query: вернувшийся компонент начинает с прошлого
 * ответа того же ключа, пока плагин отвечает заново, и клетка не прыгает.
 */

test("ключ сравнивается по содержимому: порядок полей объекта не важен", () => {
  expect(callId(["files.tree", { path: "a", git: true }])).toBe(
    callId(["files.tree", { git: true, path: "a" }]),
  );
  expect(callId(["files.tree", "a"])).not.toBe(callId(["files.tree", "b"]));
});

test("вернувшийся поток начинает с прошлого значения, свежее его заменяет", () => {
  const memory = new CallMemory();
  const id = callId(["files.tree", "/repo"]);

  const first = new Subject<string>();
  const shown = new StreamStore(() => first, memory.slot<string>(id));
  expect(shown.last).toBeUndefined();
  shown.mount();
  first.next("дерево");
  shown.unmount();

  // Смена вкладки: новый стор того же ключа — значение с первого кадра, но ответ ещё в пути.
  const again = new Subject<string>();
  const back = new StreamStore(() => again, memory.slot<string>(id));
  expect([back.status, back.last]).toEqual(["connecting", "дерево"]);
  back.mount();
  again.next("новое дерево");
  expect([back.status, back.last]).toEqual(["open", "новое дерево"]);
  back.unmount();

  // Другой ключ — своё место: чужого не показывает.
  const other = new StreamStore(() => again, memory.slot<string>(callId(["files.tree", "/b"])));
  expect(other.last).toBeUndefined();
});

test("запрос тоже начинает с прошлого ответа, статус — loading, пока плагин не ответит", () => {
  const memory = new CallMemory();
  const id = callId("shell.json");
  const source = new Subject<number>();
  const query = new QueryStore(() => source, memory.slot<number>(id));
  query.mount();
  source.next(7);
  query.unmount();

  const back = new QueryStore(() => new Subject<number>(), memory.slot<number>(id));
  expect([back.status, back.data]).toEqual(["loading", 7]);
});

test("ответ без подписчиков забывается через 10 минут, на экране — нет", () => {
  let now = 0;
  const memory = new CallMemory(() => now);
  const held = memory.slot<string>("held");
  const free = memory.slot<string>("free");
  const release = held.hold();
  held.remember("на экране");
  free.hold()();
  free.remember("ушёл");

  now = 11 * 60_000;
  expect(free.last()).toBeUndefined();
  expect(held.last()).toEqual({ value: "на экране" });
  release();
  now = 22 * 60_000;
  expect(held.last()).toBeUndefined();
});
