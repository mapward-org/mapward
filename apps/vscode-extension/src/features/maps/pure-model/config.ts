import * as T from "typebox";
import { Check } from "typebox/value";

/** The file as written by a human: `baseUrl` may be left out. */
export const RawMapEntry = T.Object({
  mapUrl: T.String(),
  baseUrl: T.Optional(T.String()),
});

export const RawConfig = T.Object({ maps: T.Array(RawMapEntry) });

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

/** Until the map itself is read, its folder name is the best label we have. */
export function mapName(mapPath: string): string {
  const segments = mapPath.replaceAll("\\", "/").split("/").filter(Boolean);
  return segments.at(-1) ?? mapPath;
}

export const CONFIG_FILE = "mapward.json";

export const EMPTY_CONFIG = `{\n  "maps": [\n    { "mapUrl": "map" }\n  ]\n}\n`;
