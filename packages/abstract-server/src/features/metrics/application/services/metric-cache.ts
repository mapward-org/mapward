import type { MapMetric } from "@mapward/core";
import type { FileReader, FileWriter } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";

export type Collected = { updatedAt: string; ok: boolean; data: unknown };

export type CacheFile = "collect.json" | "transform.json";
export type LogFile = "collect.logs.json" | "transform.logs.json";

/**
 * The cache lives with the object even when the config came from a prototype: definitions are
 * inherited, state is not — decision 0002.
 */
export class MetricCache {
  constructor(
    private readonly reader: FileReader,
    private readonly writer: FileWriter,
  ) {}

  async read(metric: MapMetric, file: CacheFile): Promise<Collected | undefined> {
    const text = await this.reader.read(join(metric.cachePath, file));
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as Collected;
    } catch {
      return undefined;
    }
  }

  async write(metric: MapMetric, file: CacheFile, value: Collected): Promise<void> {
    await this.writer.write(join(metric.cachePath, file), JSON.stringify(value, null, 2) + "\n");
  }

  /** Logs explain a red dot; without them a failed run says only that it failed. */
  async writeLogs(metric: MapMetric, file: LogFile, log: string): Promise<void> {
    await this.writer.write(join(metric.cachePath, file), log);
  }

  /** Логи прогона — по просьбе: они жирные, и в каждый ответ им не место (решение 0016). */
  async readLogs(metric: MapMetric): Promise<{ collect?: string; transform?: string } | undefined> {
    const [collect, transform] = await Promise.all([
      this.reader.read(join(metric.cachePath, "collect.logs.json")),
      this.reader.read(join(metric.cachePath, "transform.logs.json")),
    ]);
    if (collect === undefined && transform === undefined) return undefined;
    return {
      ...(collect === undefined ? {} : { collect }),
      ...(transform === undefined ? {} : { transform }),
    };
  }
}
