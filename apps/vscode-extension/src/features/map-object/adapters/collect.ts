import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { MapMetric, MapObject } from "../pure-model/model.ts";
import { childrenMap } from "../_children-map/pure-model/children.ts";
import { excluded, matchesAny } from "../pure-model/glob.ts";
import { objectEnv, parseAnswer, runAgent, shapeHint } from "./agent.ts";

const run = promisify(exec);
const encode = (text: string) => new TextEncoder().encode(text);

export type Collected = { updatedAt: string; ok: boolean; data: unknown; log?: string };

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

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Globs match the path relative to `basePath`, so a config says `**\/*.md` and means it on
 * every platform. With `include` set, a folder that holds nothing matching is left out: the
 * point of filtering is not to show the empty scaffolding around two files.
 */
async function readDir(base: string, spec: ReadDirSpec): Promise<FileNode[]> {
  const walk = async (uri: vscode.Uri, prefix: string): Promise<FileNode[]> => {
    const nodes: FileNode[] = [];

    for (const [name, type] of await vscode.workspace.fs.readDirectory(uri)) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (excluded(relative, spec.exclude)) continue;

      const child = vscode.Uri.joinPath(uri, name);
      const isDir = type === vscode.FileType.Directory;

      if (isDir) {
        // Depth first on purpose: the tree is read in the order it will be shown.
        // oxlint-disable-next-line no-await-in-loop
        const children = await walk(child, relative);
        if (spec.include?.length && children.length === 0) continue;
        // `link`, not `path`: the tree display opens whatever a node links to — decision 0004.
        nodes.push({ name, label: name, link: child.fsPath, isDir, children });
        continue;
      }

      if (!matchesAny(relative, spec.include)) continue;
      // oxlint-disable-next-line no-await-in-loop
      const text = spec.content ? await readText(child) : undefined;
      nodes.push({
        name,
        label: name,
        link: child.fsPath,
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

  return walk(vscode.Uri.file(base), "");
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map(String) : undefined;

/** Runs one collector. */
async function collector(
  spec: Record<string, unknown>,
  cwd: string,
  owner: MapObject,
  displayKind: string | undefined,
): Promise<{ value: unknown; log?: string }> {
  switch (spec.kind) {
    case "static":
      return { value: spec.value };
    case "script": {
      const { stdout, stderr } = await run(String(spec.run), {
        cwd,
        windowsHide: true,
        // Decision 0004: a script gets its object through the environment, because
        // substitution cannot reach inside the script body.
        env: objectEnv(owner, cwd),
      });
      const text = stdout.trim();
      try {
        return { value: JSON.parse(text), log: stderr || undefined };
      } catch {
        return { value: { text }, log: stderr || undefined };
      }
    }
    case "prompt": {
      // The display knows its own shape, so the agent is told it rather than guessing.
      const prompt = `${String(spec.prompt)}\n\n${shapeHint(displayKind)}`;
      const { stdout, stderr } = await runAgent({ prompt, cwd, env: objectEnv(owner, cwd) });
      return { value: parseAnswer(stdout), log: stderr || undefined };
    }
    case "read-dir": {
      return {
        value: {
          children: await readDir(String(spec.basePath), {
            include: strings(spec.include),
            exclude: strings(spec.exclude),
            content: spec.content === true,
          }),
        },
      };
    }
    case "object-children-map": {
      const exclude = strings(spec.exclude) ?? [];
      return { value: childrenMap(owner, exclude) };
    }
    default:
      throw new Error(`Коллектор ${String(spec.kind)} ещё не поддержан`);
  }
}

/**
 * `collect.json` is written only when the metric asks for it — decision 0004. A script that
 * runs in milliseconds gains nothing from a cache and would put a diff in the repository on
 * every look at the map. Logs are always written: they are what a red dot points at.
 *
 * On failure the previous data stays: the value was true once, we just could not refresh it.
 */
export async function collect(
  metric: MapMetric,
  owner: MapObject,
  cwd: string,
): Promise<Collected> {
  const specs = metric.config.collectors ?? [];
  const previous = await readCache(metric);

  try {
    const results = await Promise.all(
      specs.map((spec) => collector(spec, cwd, owner, metric.config.display?.kind)),
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

    const collected: Collected = { updatedAt: new Date().toISOString(), ok: true, data };
    await write(metric, collected, log);
    return collected;
  } catch (error) {
    const failed: Collected = {
      updatedAt: new Date().toISOString(),
      ok: false,
      data: previous?.data,
    };
    await write(metric, failed, error instanceof Error ? error.message : String(error));
    return failed;
  }
}

export const cacheUri = (metric: MapMetric, file: string) =>
  vscode.Uri.joinPath(vscode.Uri.file(metric.configPath), "..", file);

export async function readCache(metric: MapMetric): Promise<Collected | undefined> {
  if (!metric.config.collectorsCache) return undefined;
  try {
    const bytes = await vscode.workspace.fs.readFile(cacheUri(metric, "collect.json"));
    return JSON.parse(new TextDecoder().decode(bytes)) as Collected;
  } catch {
    return undefined;
  }
}

export async function writeCache(
  metric: MapMetric,
  file: string,
  value: unknown,
): Promise<void> {
  await vscode.workspace.fs.writeFile(
    cacheUri(metric, file),
    encode(JSON.stringify(value, null, 2) + "\n"),
  );
}

export async function writeLogs(metric: MapMetric, file: string, log: string): Promise<void> {
  await vscode.workspace.fs.writeFile(cacheUri(metric, file), encode(log));
}

async function write(metric: MapMetric, value: Collected, log?: string): Promise<void> {
  if (metric.config.collectorsCache) await writeCache(metric, "collect.json", value);
  // Logs explain a red dot; without them a failed run says only that it failed.
  if (log) await writeLogs(metric, "collect.logs.json", log);
}
