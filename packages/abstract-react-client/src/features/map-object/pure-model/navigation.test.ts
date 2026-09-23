import { expect, test } from "vitest";
import {
  amend,
  currentScreen,
  historyLimit,
  isHistory,
  parseScreen,
  screenToString,
  startHistory,
  stepTarget,
  stepTo,
  visit,
} from "./navigation.ts";

const all = () => true;
const notGone = (address: string) => address !== "mapward://gone";

test("экран пишется строкой и читается обратно", () => {
  const screen = {
    address: "mapward://packages/core",
    group: "тяжёлое",
    meta: true,
    solo: "files",
  };
  const text = screenToString(screen);
  expect(text).toBe(
    `mapward://packages/core?group=${encodeURIComponent("тяжёлое")}&meta&solo=files`,
  );
  expect(parseScreen(text)).toEqual(screen);
});

test("голый объект пишется голым адресом", () => {
  expect(screenToString({ address: "mapward://packages/core" })).toBe("mapward://packages/core");
  expect(parseScreen("mapward://packages/core")).toEqual({ address: "mapward://packages/core" });
});

test("без стартового экрана история начинается с корня", () => {
  expect(currentScreen(startHistory())).toEqual({ address: "mapward://" });
});

test("переход кладёт шаг и отрезает всё, что было «вперёд»", () => {
  let history = startHistory();
  history = visit(history, "mapward://a");
  history = visit(history, "mapward://b");
  history = stepTo(history, 1);
  history = visit(history, "mapward://c");
  expect(history.entries).toEqual(["mapward://", "mapward://a", "mapward://c"]);
  expect(history.index).toBe(2);
});

test("переход на тот же объект шага не кладёт, но сбрасывает вкладку и мету", () => {
  let history = visit(startHistory(), "mapward://a");
  history = amend(history, { meta: true, group: "g" });
  history = visit(history, "mapward://a");
  expect(history.entries).toEqual(["mapward://", "mapward://a"]);
  expect(currentScreen(history)).toEqual({ address: "mapward://a" });
});

test("вкладка, мета и метрика переписывают текущий шаг, а не кладут новый", () => {
  let history = visit(startHistory(), "mapward://a");
  history = amend(history, { group: "g" });
  history = amend(history, { solo: "files" });
  history = amend(history, { meta: true });
  history = amend(history, { meta: false, solo: undefined });
  expect(history.entries).toEqual(["mapward://", "mapward://a?group=g"]);
});

test("история держит не больше предела, старые шаги уходят", () => {
  let history = startHistory();
  for (let n = 0; n < historyLimit + 10; n += 1) history = visit(history, `mapward://o${n}`);
  expect(history.entries).toHaveLength(historyLimit);
  expect(history.index).toBe(historyLimit - 1);
  expect(history.entries.at(-1)).toBe(`mapward://o${historyLimit + 9}`);
});

test("стрелка перешагивает мёртвые адреса и гаснет, когда идти некуда", () => {
  let history = startHistory();
  history = visit(history, "mapward://gone");
  history = visit(history, "mapward://b");
  history = visit(history, "mapward://c");
  expect(stepTarget(history, -1, notGone)).toBe(2);
  expect(stepTarget(stepTo(history, 2), -1, notGone)).toBe(0);
  expect(stepTarget(stepTo(history, 0), -1, notGone)).toBeUndefined();
  expect(stepTarget(history, 1, all)).toBeUndefined();
  expect(stepTarget(stepTo(history, 0), 1, notGone)).toBe(2);
});

test("испорченное сохранённое историей не считается", () => {
  expect(isHistory(startHistory())).toBe(true);
  expect(isHistory(undefined)).toBe(false);
  expect(isHistory({ entries: [], index: 0 })).toBe(false);
  expect(isHistory({ entries: ["mapward://"], index: 1 })).toBe(false);
  expect(isHistory({ entries: [1], index: 0 })).toBe(false);
});
