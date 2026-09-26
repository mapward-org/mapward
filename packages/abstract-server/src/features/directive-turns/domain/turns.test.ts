import { expect, test } from "vitest";
import { removed, turnTaken, upsert, type ActionTurn, type DirectiveTurn } from "./turns.ts";

const turn = (over: Partial<DirectiveTurn> = {}): DirectiveTurn => ({
  kind: "directive",
  state: "waiting",
  mapPath: "/map",
  address: "mapward://",
  object: "Mapward",
  directive: "2026-09-23-0008-a.md",
  path: "/map/_directives/2026-09-23-0008-a.md",
  stage: "План",
  at: "2026-09-23T01:00:00.000Z",
  ...over,
});

const action = (over: Partial<ActionTurn> = {}): ActionTurn => ({
  kind: "action",
  state: "running",
  mapPath: "/map",
  address: "mapward://",
  object: "Mapward",
  run: "r1",
  label: "релиз",
  at: "2026-09-23T01:00:00.000Z",
  ...over,
});

test("новый пункт кладётся наверх", () => {
  const first = turn();
  const second = turn({ directive: "b.md" });
  expect(upsert(upsert([], first), second)).toEqual([second, first]);
});

test("повторное событие директивы поднимает её пункт, а не добавляет второй", () => {
  const a = turn();
  const b = turn({ directive: "b.md" });
  const again = turn({ stage: "Реализация", state: "running", at: "2026-09-23T02:00:00.000Z" });
  expect(upsert([b, a], again)).toEqual([again, b]);
});

test("одно имя файла у разных объектов и карт — разные директивы", () => {
  const here = turn();
  const otherObject = turn({ address: "mapward://packages/core" });
  const otherMap = turn({ mapPath: "/other" });
  expect(upsert(upsert([here], otherObject), otherMap)).toHaveLength(3);
  expect(turnTaken([otherMap, otherObject, here], here)).toEqual([otherMap, otherObject]);
});

test("прогон узнаётся номером в своей карте, а не директивой", () => {
  const run = action();
  const list = upsert([turn()], run);
  expect(upsert(list, action({ state: "failed" }))).toEqual([action({ state: "failed" }), turn()]);
  expect(removed(list, { mapPath: "/other", run: "r1" })).toBe(list);
  expect(removed(list, { mapPath: "/map", run: "r1" })).toEqual([turn()]);
});

test("взятый ход убирает ждущее и упавшее, а без пункта список остаётся тем же", () => {
  const list = [turn(), action({ state: "failed" })];
  expect(turnTaken(list, turn())).toEqual([action({ state: "failed" })]);
  expect(turnTaken(list, { mapPath: "/map", run: "r1" })).toEqual([turn()]);
  expect(turnTaken(list, turn({ directive: "other.md" }))).toBe(list);
});

test("идущее по клику не уходит — оно уйдёт само, когда кончится", () => {
  const list = [turn({ state: "running" }), action()];
  expect(turnTaken(list, turn())).toBe(list);
  expect(turnTaken(list, { mapPath: "/map", run: "r1" })).toBe(list);
});
