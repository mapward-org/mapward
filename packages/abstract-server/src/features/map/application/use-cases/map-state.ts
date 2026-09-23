import type { FileReader, FileWriter } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";

const MAP_STATE = "map-state.json";

/** Положение узлов лежит рядом с картой: её видят все, кто её открыл. */
export class ReadMapState {
  constructor(private readonly files: FileReader) {}

  async run(params: { mapPath: string }): Promise<unknown> {
    const text = await this.files.read(join(params.mapPath, MAP_STATE));
    if (text === undefined) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

export class WriteMapState {
  constructor(private readonly files: FileWriter) {}

  async run(params: { mapPath: string; value: unknown }): Promise<void> {
    await this.files.write(
      join(params.mapPath, MAP_STATE),
      JSON.stringify(params.value, null, 2) + "\n",
    );
  }
}
