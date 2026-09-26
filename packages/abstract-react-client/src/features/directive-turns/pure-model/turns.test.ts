import { expect, test } from "vitest";
import type { Turn } from "@mapward/core";
import { badge, buttonState, stateLabel, turnLabel, waited } from "./turns.ts";

const turn: Turn = {
  kind: "directive",
  state: "waiting",
  mapPath: "/map",
  address: "mapward://",
  object: "Mapward (ru)",
  directive: "2026-09-23-0008-давай-добавим-нотификцию-по-этапам.md",
  path: "/map/_directives/x.md",
  stage: "План",
  at: "2026-09-23T01:00:00.000Z",
};

test("подпись — объект, директива без даты и расширения, этап", () => {
  expect(turnLabel(turn)).toBe("Mapward (ru) · давай-добавим-нотификцию-по-этапам · План");
});

const action: Turn = {
  kind: "action",
  state: "running",
  mapPath: "/map",
  address: "mapward://",
  object: "Mapward (ru)",
  run: "r1",
  label: "Релиз",
  at: "2026-09-23T01:00:00.000Z",
};

test("подпись экшона — объект и экшон, со словом о том, что с ним", () => {
  expect(turnLabel(action)).toBe("Mapward (ru) · Релиз");
  expect(stateLabel(action)).toBe("идёт");
  expect(stateLabel({ ...action, state: "failed" })).toBe("упал");
  expect(stateLabel(turn)).toBeUndefined();
});

test("число — то, что ждёт человека; одно идущее — лоадер без числа", () => {
  expect(buttonState([action])).toEqual({ count: 0, busy: true });
  expect(buttonState([action, turn, { ...action, run: "r2", state: "failed" }])).toEqual({
    count: 2,
    busy: true,
  });
  expect(buttonState([turn])).toEqual({ count: 1, busy: false });
});

test("сколько ждёт — грубо, по крупнейшей единице", () => {
  const at = Date.parse(turn.at);
  expect(waited(turn.at, at + 30_000)).toBe("только что");
  expect(waited(turn.at, at + 5 * 60_000)).toBe("5 мин");
  expect(waited(turn.at, at + 3 * 3_600_000)).toBe("3 ч");
  expect(waited(turn.at, at + 50 * 3_600_000)).toBe("2 д");
  // Часы хоста впереди вебвью — не «минус минута».
  expect(waited(turn.at, at - 60_000)).toBe("только что");
});

test("на кнопке больше девяти — «9+»", () => {
  expect(badge(3)).toBe("3");
  expect(badge(12)).toBe("9+");
});
