import { expect, test } from "vitest";
import { stageFinished, turnTaken, type Turn } from "./turns.ts";

const turn = (over: Partial<Turn> = {}): Turn => ({
  mapPath: "/map",
  address: "mapward://",
  object: "Mapward",
  directive: "2026-09-23-0008-a.md",
  path: "/map/_directives/2026-09-23-0008-a.md",
  stage: "План",
  at: "2026-09-23T01:00:00.000Z",
  ...over,
});

test("конец этапа кладёт директиву наверх", () => {
  const first = turn();
  const second = turn({ directive: "b.md" });
  expect(stageFinished(stageFinished([], first), second)).toEqual([second, first]);
});

test("повторный конец этапа поднимает пункт, а не добавляет второй", () => {
  const a = turn();
  const b = turn({ directive: "b.md" });
  const again = turn({ stage: "Реализация", at: "2026-09-23T02:00:00.000Z" });
  expect(stageFinished([b, a], again)).toEqual([again, b]);
});

test("одно имя файла у разных объектов и карт — разные директивы", () => {
  const here = turn();
  const otherObject = turn({ address: "mapward://packages/core" });
  const otherMap = turn({ mapPath: "/other" });
  expect(stageFinished(stageFinished([here], otherObject), otherMap)).toHaveLength(3);
  expect(turnTaken([otherMap, otherObject, here], here)).toEqual([otherMap, otherObject]);
});

test("взятый ход убирает пункт, а без пункта список остаётся тем же", () => {
  const list = [turn()];
  expect(turnTaken(list, turn())).toEqual([]);
  expect(turnTaken(list, turn({ directive: "other.md" }))).toBe(list);
});
