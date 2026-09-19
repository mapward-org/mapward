import * as T from "typebox";
import { Check } from "typebox/value";

/** The file as written by a human: `baseUrl` may be left out. */
export const RawMapEntry = T.Object({
  mapUrl: T.String(),
  baseUrl: T.Optional(T.String()),
});

export const RawConfig = T.Object({
  maps: T.Array(RawMapEntry),
  // Свойство машины и карты, а не метрики, поэтому живёт здесь — решение 0013.
  metricsConcurrency: T.Optional(T.Number()),
});

export type MapEntry = { mapUrl: string; baseUrl: string };

export class ConfigError extends Error {}

/**
 * Parsing and defaults stay pure so they can be tested without a file system, and later
 * reused by the cli, which has no vscode under it.
 */
export function parseConfig(text: string): MapEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`mapward.json is not valid json: ${(error as Error).message}`);
  }

  if (!Check(RawConfig, parsed)) {
    throw new ConfigError("mapward.json must be { maps: [{ mapUrl, baseUrl? }] }");
  }

  return parsed.maps.map((entry) => ({
    mapUrl: entry.mapUrl,
    baseUrl: entry.baseUrl ?? ".",
  }));
}

/** Настройки рантайма из того же файла: карты берут их себе при подъёме сервера. */
export function parseSettings(text: string): { metricsConcurrency?: number } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Check(RawConfig, parsed) && parsed.metricsConcurrency !== undefined) {
      return { metricsConcurrency: parsed.metricsConcurrency };
    }
  } catch {
    // Настройки не повод ронять карту: без них она работает как раньше.
  }
  return {};
}

/** Only the field we need here — reading the map itself comes later. */
export const MapIndex = T.Object({ name: T.Optional(T.String()) });

function folderName(mapPath: string): string {
  const segments = mapPath.replaceAll("\\", "/").split("/").filter(Boolean);
  return segments.at(-1) ?? mapPath;
}

/**
 * The map names itself in `_index.json`. A missing or broken index must not hide the map,
 * so the folder name stands in — an error belongs on the object, not over the whole sidebar.
 */
export function mapName(indexText: string | undefined, mapPath: string): string {
  if (indexText) {
    try {
      const parsed: unknown = JSON.parse(indexText);
      if (Check(MapIndex, parsed) && parsed.name) return parsed.name;
    } catch {
      // fall through to the folder name
    }
  }
  return folderName(mapPath);
}

export const CONFIG_FILE = "mapward.json";

export const INDEX_FILE = "_index.json";

export const EMPTY_CONFIG = `{\n  "maps": [\n    { "mapUrl": "map" }\n  ]\n}\n`;
