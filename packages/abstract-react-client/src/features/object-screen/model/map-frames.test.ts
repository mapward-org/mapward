import { expect, test } from "vitest";
import { startHistory, visit } from "../pure-model/navigation.ts";
import { MapFrames } from "./map-frames.ts";

const space = { mapPath: "/space/map", basePath: "/space", name: "Пространство" };
const leafer = { mapPath: "/space/leafer/map", basePath: "/space/leafer", name: "Leafer" };

const resolve = (_from: unknown, mount: string) =>
  mount === "leafer" ? leafer : { error: `У карты нет подключения «${mount}»` };

/**
 * Объект подключённой карты открывается кадром поверх прежнего: экран целиком живёт на одной
 * карте. «Назад» возвращает в прежний, и тот встаёт с той историей, с какой из него ушли.
 */
test("a link to a mounted map's object opens its frame, and leaving returns where we left", () => {
  const saved: unknown[] = [];
  const frames = new MapFrames({ map: space }, resolve, (history) => saved.push(history));
  const here = visit(startHistory({ address: "mapward://" }), "mapward://summary");

  expect(frames.enter("mapward://leafer:/arch", here)).toBe(true);
  expect(frames.top).toEqual({
    map: leafer,
    mount: "leafer",
    start: { address: "mapward://arch" },
  });
  expect(frames.leave?.name).toBe("Пространство › leafer:");

  // История кадра подключённой карты держится, но не сохраняется: хранится только нижняя.
  frames.save(startHistory({ address: "mapward://arch" }));
  expect(saved).toEqual([]);

  frames.leave?.go();
  expect(frames.top).toEqual({ map: space, history: here });
  expect(frames.leave).toBeUndefined();

  frames.save(here);
  expect(saved).toEqual([here]);
});

test("a link to a map that is not mounted opens nothing", () => {
  const frames = new MapFrames({ map: space }, resolve);
  expect(frames.enter("mapward://ed:/core", startHistory({ address: "mapward://" }))).toBe(false);
  expect(frames.enter("mapward://core", startHistory({ address: "mapward://" }))).toBe(false);
  expect(frames.key).toBe(1);
});

test("a tab for a mounted map's object opens on that map", () => {
  const frames = new MapFrames({ map: space }, resolve);
  expect(frames.target("mapward://leafer:/arch")).toEqual({
    map: leafer,
    address: "mapward://arch",
  });
  expect(frames.target("mapward://arch")).toBeUndefined();
});
