import type { MapObject } from "@mapward/core";
import type { ProcessEnv } from "../lib/env.ts";
import { slash } from "../lib/path.ts";

/**
 * `MAPWARD_OBJECT_PATH` is the path from the map root, as decision 0004 says — which makes it
 * the object's address without the scheme, and that is what a script needs to tell whose
 * requirement it is holding.
 */
function objectPath(owner: MapObject, mapPath: string): string {
  const path = slash(owner.path);
  const root = slash(mapPath);
  return path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, "") : path;
}

/**
 * Same environment a script collector gets: substitution cannot reach inside a prompt either.
 * Общее у метрик и экшонов: и те и другие зовут скрипт и агента от имени объекта.
 */
export function objectEnv(owner: MapObject, mapPath: string, base: ProcessEnv): ProcessEnv {
  return {
    ...base,
    MAPWARD_MAP_PATH: mapPath,
    MAPWARD_OBJECT_PATH: objectPath(owner, mapPath),
    MAPWARD_OBJECT_NAME: owner.name,
    MAPWARD_OBJECT: JSON.stringify({ name: owner.name, props: owner.props }),
  };
}
