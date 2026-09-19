import type { ServerPorts } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";

const MAP_STATE = "map-state.json";

/** Положение узлов лежит рядом с картой: её видят все, кто её открыл. */
export async function readMapState(
  ports: ServerPorts,
  params: { mapPath: string },
): Promise<unknown> {
  const text = await ports.files.read(join(params.mapPath, MAP_STATE));
  if (text === undefined) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function writeMapState(
  ports: ServerPorts,
  params: { mapPath: string; value: unknown },
): Promise<void> {
  await ports.files.write(
    join(params.mapPath, MAP_STATE),
    JSON.stringify(params.value, null, 2) + "\n",
  );
}
