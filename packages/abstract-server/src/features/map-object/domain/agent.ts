import type { MapObject } from "@mapward/core";
import type { ProcessEnv } from "../../../lib/env.ts";
import { slash } from "../../../lib/path.ts";

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

/** Same environment a script collector gets: substitution cannot reach inside a prompt either. */
export function objectEnv(owner: MapObject, mapPath: string, base: ProcessEnv): ProcessEnv {
  return {
    ...base,
    MAPWARD_MAP_PATH: mapPath,
    MAPWARD_OBJECT_PATH: objectPath(owner, mapPath),
    MAPWARD_OBJECT_NAME: owner.name,
    MAPWARD_OBJECT: JSON.stringify({ name: owner.name, props: owner.props }),
  };
}

/**
 * An agent answers in prose unless asked otherwise, and even when asked it likes a fence. We
 * take the first json object or array we can parse; failing that the text itself is the answer,
 * which at least shows on a `text` display instead of an error.
 */
export function parseAnswer(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]?.trim();
  const candidates = [fenced, text].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.search(/[{[]/);
      const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
      if (start === -1 || end <= start) continue;
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }

  return { text };
}
