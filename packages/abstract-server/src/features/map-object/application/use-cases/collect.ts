import { childrenMap } from "@mapward/core";
import type { MapMetric, MapObject } from "@mapward/core";
import type { Cancellation, FilesPort, ServerPorts } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";
import { excluded, matchesAny } from "../../domain/glob.ts";
import { displayHint } from "./display-schema.ts";
import { objectEnv, parseAnswer } from "../../domain/agent.ts";
import { runPrompt, runScript } from "./execute.ts";

export type Collected = { updatedAt: string; ok: boolean; data: unknown };

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
async function readDir(files: FilesPort, base: string, spec: ReadDirSpec): Promise<FileNode[]> {
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

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map(String) : undefined;

/** Runs one collector. */
async function collector(
  ports: ServerPorts,
  spec: Record<string, unknown>,
  cwd: string,
  owner: MapObject,
  /** Что сказать агенту о форме ответа: форма дисплея или схема компонента (решение 0037). */
  hint: string,
  cancel?: Cancellation,
): Promise<{ value: unknown; log?: string }> {
  const env = () => objectEnv(owner, cwd, ports.env.vars());

  switch (spec.kind) {
    case "static":
      return { value: spec.value };
    case "script": {
      // Decision 0004: a script gets its object through the environment, because substitution
      // cannot reach inside the script body. It runs from the map root.
      const { stdout, stderr } = await runScript(ports, {
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
      const { stdout, stderr } = await runPrompt(ports, {
        owner,
        text: String(spec.prompt),
        tail: hint,
        cwd,
        env: env(),
        cancel,
      });
      return { value: parseAnswer(stdout), log: stderr || undefined };
    }
    case "read-dir": {
      return {
        value: {
          children: await readDir(ports.files, String(spec.basePath), {
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
      return { value: childrenMap(owner, exclude, include) };
    }
    default:
      throw new Error(`Коллектор ${String(spec.kind)} ещё не поддержан`);
  }
}

export const cachePath = (metric: MapMetric, file: string) => join(metric.cachePath, file);

/**
 * The cache lives with the object even when the config came from a prototype: definitions are
 * inherited, state is not — decision 0002.
 */
export async function readCache(
  files: FilesPort,
  metric: MapMetric,
  file: "collect.json" | "transform.json",
): Promise<Collected | undefined> {
  const text = await files.read(cachePath(metric, file));
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as Collected;
  } catch {
    return undefined;
  }
}

export async function writeCache(
  files: FilesPort,
  metric: MapMetric,
  file: string,
  value: unknown,
): Promise<void> {
  await files.write(cachePath(metric, file), JSON.stringify(value, null, 2) + "\n");
}

export async function writeLogs(
  files: FilesPort,
  metric: MapMetric,
  file: string,
  log: string,
): Promise<void> {
  await files.write(cachePath(metric, file), log);
}

/**
 * `collect.json` is written only when the metric asks for it — decision 0004. A script that
 * runs in milliseconds gains nothing from a cache and would put a diff in the repository on
 * every look at the map. Logs are always written: they are what a red dot points at.
 *
 * On failure the previous data stays: the value was true once, we just could not refresh it.
 */
export async function collect(
  ports: ServerPorts,
  metric: MapMetric,
  owner: MapObject,
  cwd: string,
  cancel?: Cancellation,
  previous?: Collected,
  /** Лог стадии — прогону метрики на экране прогонов (решение 0038). */
  report?: (log: string) => void,
): Promise<Collected> {
  const specs = metric.config.collectors ?? [];
  // Прошлое значение — сперва то, что уже показано, потом кэш на диске. У метрики без
  // `collectorsCache` диска нет вовсе, но показанное значение было, и неудача его не отменяет:
  // правило «при неуспехе данные не затираются» не про то, где они лежали.
  const before =
    previous ??
    (metric.config.collectorsCache
      ? await readCache(ports.files, metric, "collect.json")
      : undefined);

  try {
    const hint = await displayHint(ports.files, metric.config.display);
    const results = await Promise.all(
      specs.map((spec) => collector(ports, spec, cwd, owner, hint, cancel)),
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

    const collected: Collected = { updatedAt: ports.clock.now(), ok: true, data };
    report?.(log);
    await write(ports, metric, collected, log);
    return collected;
  } catch (error) {
    // Отмена — это отсутствие ответа, а не неудачный ответ: правило «при неуспехе данные не
    // затираются» к ней не относится, писать нечего вовсе (решение 0013).
    if (cancel?.cancelled) throw error;

    const failed: Collected = {
      updatedAt: ports.clock.now(),
      ok: false,
      data: before?.data,
    };
    const log = error instanceof Error ? error.message : String(error);
    report?.(log);
    await write(ports, metric, failed, log);
    return failed;
  }
}

async function write(
  ports: ServerPorts,
  metric: MapMetric,
  value: Collected,
  log?: string,
): Promise<void> {
  if (metric.config.collectorsCache) {
    await writeCache(ports.files, metric, "collect.json", value);
  }
  // Logs explain a red dot; without them a failed run says only that it failed.
  if (log) await writeLogs(ports.files, metric, "collect.logs.json", log);
}
