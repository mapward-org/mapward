import { childrenMap } from "@mapward/core";
import type { MapMetric, MapObject } from "@mapward/core";
import type { Cancellation, ClockPort, EnvPort, FileReader } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";
import { objectEnv } from "../../../../kernel/object-env.ts";
import { excluded, matchesAny } from "../../domain/glob.ts";
import { parseAnswer } from "../../domain/answer.ts";
import type { MetricsDisplaySchema, MetricsExecutor } from "../../ports.ts";
import type { Collected, MetricCache } from "../services/metric-cache.ts";

/** Лог и результат стадии — в шаг прогона метрики на экране прогонов (решение 0038). */
export type StageReport = (log: string, output?: unknown) => void;

/**
 * Ответ агента как есть — в лог стадии: он разбирается в данные, и без этого на экране прогонов
 * не видно, что агент сказал на самом деле (решение 0038).
 */
export const answerLog = (stderr: string, stdout: string): string | undefined =>
  [stderr.trim(), stdout.trim() && `ответ агента:\n${stdout.trim()}`]
    .filter(Boolean)
    .join("\n\n") || undefined;

type FileNode = {
  name: string;
  link: string;
  isDir?: boolean;
  label: string;
  children: FileNode[];
  /** Only with `content: true` — decision 0010: a status lives inside the file, not in its name. */
  text?: string;
};

type ReadDirSpec = {
  include?: string[];
  exclude?: string[];
  content?: boolean;
};

/**
 * Globs match the path relative to `basePath`, so a config says one pattern and means it on
 * every platform. With `include` set, a folder that holds nothing matching is left out: the
 * point of filtering is not to show the empty scaffolding around two files.
 */
async function readDir(files: FileReader, base: string, spec: ReadDirSpec): Promise<FileNode[]> {
  const walk = async (path: string, prefix: string): Promise<FileNode[]> => {
    const nodes: FileNode[] = [];

    for (const entry of await files.list(path)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded(relative, spec.exclude)) continue;

      const child = join(path, entry.name);

      if (entry.isDirectory) {
        // Depth first on purpose: the tree is read in the order it will be shown.
        // oxlint-disable-next-line no-await-in-loop
        const children = await walk(child, relative);
        if (spec.include?.length && children.length === 0) continue;
        // `link`, not `path`: the tree display opens whatever a node links to — decision 0004.
        nodes.push({ name: entry.name, label: entry.name, link: child, isDir: true, children });
        continue;
      }

      if (!matchesAny(relative, spec.include)) continue;
      // oxlint-disable-next-line no-await-in-loop
      const text = spec.content ? await files.read(child) : undefined;
      nodes.push({
        name: entry.name,
        label: entry.name,
        link: child,
        isDir: false,
        children: [],
        ...(text === undefined ? {} : { text }),
      });
    }

    // The explorer's order: folders first, then names, case ignored.
    return nodes.toSorted((a, b) =>
      a.isDir === b.isDir
        ? a.name.localeCompare(b.name, "ru", { sensitivity: "base" })
        : a.isDir
          ? -1
          : 1,
    );
  };

  return walk(base, "");
}

/** Размер карточки — css-строка или число пикселей; остальное в конфиге не размер. */
const size = (value: unknown): string | number | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined;

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map(String) : undefined;

/**
 * Стадия сбора метрики — решение 0004.
 *
 * `collect.json` is written only when the metric asks for it. A script that runs in
 * milliseconds gains nothing from a cache and would put a diff in the repository on every look
 * at the map. Logs are always written: they are what a red dot points at.
 *
 * On failure the previous data stays: the value was true once, we just could not refresh it.
 */
export class CollectMetric {
  constructor(
    private readonly files: FileReader,
    private readonly cache: MetricCache,
    private readonly schema: MetricsDisplaySchema,
    private readonly executor: MetricsExecutor,
    private readonly env: EnvPort,
    private readonly clock: ClockPort,
  ) {}

  async run(
    metric: MapMetric,
    owner: MapObject,
    cwd: string,
    cancel?: Cancellation,
    previous?: Collected,
    report?: StageReport,
  ): Promise<Collected> {
    const specs = metric.config.collectors ?? [];
    // Прошлое значение — сперва то, что уже показано, потом кэш на диске. У метрики без
    // `collectorsCache` диска нет вовсе, но показанное значение было, и неудача его не отменяет:
    // правило «при неуспехе данные не затираются» не про то, где они лежали.
    const before =
      previous ??
      (metric.config.collectorsCache ? await this.cache.read(metric, "collect.json") : undefined);

    try {
      const hint = await this.schema.hint(metric.config.display);
      const results = await Promise.all(
        specs.map((spec) => this.collector(spec, cwd, owner, hint, cancel)),
      );
      const log = results
        .map((result) => result.log)
        .filter(Boolean)
        .join("\n");

      const data =
        specs.length === 1
          ? results[0]?.value
          : Object.fromEntries(
              specs.map((spec, index) => [String(spec.name ?? index), results[index]?.value]),
            );

      const collected: Collected = { updatedAt: this.clock.now(), ok: true, data };
      report?.(log, data);
      await this.write(metric, collected, log);
      return collected;
    } catch (error) {
      // Отмена — это отсутствие ответа, а не неудачный ответ: правило «при неуспехе данные не
      // затираются» к ней не относится, писать нечего вовсе (решение 0013).
      if (cancel?.cancelled) throw error;

      const failed: Collected = {
        updatedAt: this.clock.now(),
        ok: false,
        data: before?.data,
      };
      const log = error instanceof Error ? error.message : String(error);
      report?.(log);
      await this.write(metric, failed, log);
      return failed;
    }
  }

  /** Runs one collector. */
  private async collector(
    spec: Record<string, unknown>,
    cwd: string,
    owner: MapObject,
    /** Что сказать агенту о форме ответа: форма дисплея или схема компонента (решение 0037). */
    hint: string,
    cancel?: Cancellation,
  ): Promise<{ value: unknown; log?: string }> {
    const env = () => objectEnv(owner, cwd, this.env.vars());

    switch (spec.kind) {
      case "static":
        return { value: spec.value };
      case "script": {
        // Decision 0004: a script gets its object through the environment, because substitution
        // cannot reach inside the script body. It runs from the map root.
        const { stdout, stderr } = await this.executor.script({
          command: String(spec.run),
          cwd,
          env: env(),
          cancel,
        });
        const text = stdout.trim();
        try {
          return { value: JSON.parse(text), log: stderr || undefined };
        } catch {
          return { value: { text }, log: stderr || undefined };
        }
      }
      case "prompt": {
        // Decision 0004: the object goes into the base prompt. Substitution reaches the text a
        // human wrote, but not the address of the object the metric hangs on.
        // The display knows its own shape, so the agent is told it rather than guessing.
        const { stdout, stderr } = await this.executor.prompt({
          owner,
          text: String(spec.prompt),
          tail: hint,
          cwd,
          env: env(),
          cancel,
        });
        return { value: parseAnswer(stdout), log: answerLog(stderr, stdout) };
      }
      case "read-dir": {
        return {
          value: {
            children: await readDir(this.files, String(spec.basePath), {
              include: strings(spec.include),
              exclude: strings(spec.exclude),
              content: spec.content === true,
            }),
          },
        };
      }
      case "object-children-map": {
        const exclude = strings(spec.exclude) ?? [];
        const include = strings(spec.include) ?? [];
        // Вкладка и размер карточек — у всех узлов сразу: размер задаёт место показа.
        const card = {
          ...(typeof spec.group === "string" ? { group: spec.group } : {}),
          ...(size(spec.width) === undefined ? {} : { width: size(spec.width) }),
          ...(size(spec.maxHeight) === undefined ? {} : { maxHeight: size(spec.maxHeight) }),
        };
        return { value: childrenMap(owner, exclude, include, card) };
      }
      default:
        throw new Error(`Коллектор ${String(spec.kind)} ещё не поддержан`);
    }
  }

  private async write(metric: MapMetric, value: Collected, log?: string): Promise<void> {
    if (metric.config.collectorsCache) await this.cache.write(metric, "collect.json", value);
    // Logs explain a red dot; without them a failed run says only that it failed.
    if (log) await this.cache.writeLogs(metric, "collect.logs.json", log);
  }
}
