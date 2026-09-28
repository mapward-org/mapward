import { expect, test } from "vitest";
import { mapsOfConfig, mountedMaps } from "./find-maps.ts";

/**
 * Подключение — ссылка на `mapward.json` проекта и номер карты в нём. Карта проекта берётся из
 * её собственного конфига, со своим корнем проекта и своими подключениями.
 */
const tree: Record<string, string> = {
  "/space/mapward.json": JSON.stringify({
    maps: [
      {
        mapUrl: "map",
        mounts: {
          leafer: "./leafer/mapward.json[1]",
          ed: "./ed/mapward.json",
          broken: "./leafer",
          gone: "./nowhere/mapward.json",
          far: "./leafer/mapward.json[5]",
          absolute: "/space/ed/mapward.json",
        },
      },
    ],
  }),
  "/space/map/_index.json": JSON.stringify({ name: "Пространство" }),
  "/space/leafer/mapward.json": JSON.stringify({
    maps: [{ mapUrl: "docs/map" }, { mapUrl: "arch/map", mounts: { back: "../mapward.json" } }],
  }),
  "/space/leafer/arch/map/_index.json": JSON.stringify({ name: "Leafer" }),
  "/space/ed/mapward.json": JSON.stringify({ maps: [{ mapUrl: "map" }] }),
};

const read = (path: string) => Promise.resolve(tree[path]);

test("a mount leads to a map of the project's own config, by its number there", async () => {
  const [space] = await mapsOfConfig(read, "/space/mapward.json");
  expect(space?.mounts).toEqual({
    leafer: {
      mapPath: "/space/leafer/arch/map",
      configPath: "/space/leafer/mapward.json",
      index: 1,
    },
    ed: { mapPath: "/space/ed/map", configPath: "/space/ed/mapward.json", index: 0 },
    broken: { error: expect.stringContaining("должно вести на mapward.json") },
    gone: { error: "Нет mapward.json по пути /space/nowhere/mapward.json" },
    far: { error: "В /space/leafer/mapward.json нет карты с номером 5" },
    absolute: { mapPath: "/space/ed/map", configPath: "/space/ed/mapward.json", index: 0 },
  });
});

test("mounted maps rise once each, with their own project root and their own mounts", async () => {
  const shown = await mapsOfConfig(read, "/space/mapward.json");
  const mounted = await mountedMaps(read, shown);
  expect(mounted.map((map) => [map.name, map.mapPath, map.basePath])).toEqual([
    ["Leafer", "/space/leafer/arch/map", "/space/leafer"],
    ["map", "/space/ed/map", "/space/ed"],
  ]);
  // Подключение проекта назад к пространству — круг: карта уже поднята и второй раз не идёт.
  expect(mounted[0]?.mounts?.back).toMatchObject({ mapPath: "/space/map" });
});
