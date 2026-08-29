import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { MapMetric } from "../pure-model/model.ts";

const run = promisify(exec);
const encode = (text: string) => new TextEncoder().encode(text);

export type Collected = { updatedAt: string; ok: boolean; data: unknown; log?: string };

type FileNode = {
  name: string;
  path: string;
  isDir?: boolean;
  label: string;
  children: FileNode[];
};

async function readDir(base: string, exclude: string[]): Promise<FileNode[]> {
  const skip = (name: string) => exclude.some((glob) => glob.replaceAll("*", "").includes(name));
  const walk = async (uri: vscode.Uri): Promise<FileNode[]> => {
    const nodes: FileNode[] = [];
    for (const [name, type] of await vscode.workspace.fs.readDirectory(uri)) {
      if (skip(name)) continue;
      // Depth first on purpose: the tree is read in the order it will be shown.
      // oxlint-disable-next-line no-await-in-loop
      const child = vscode.Uri.joinPath(uri, name);
      const isDir = type === vscode.FileType.Directory;
      // oxlint-disable-next-line no-await-in-loop
      const children = isDir ? await walk(child) : [];
      nodes.push({ name, label: name, path: child.fsPath, isDir, children });
    }
    return nodes;
  };
  return walk(vscode.Uri.file(base));
}

/**
 * Runs one collector. `prompt` waits for the agent work of a later step; until then it says
 * so rather than pretending to have data.
 */
async function collector(
  spec: Record<string, unknown>,
  cwd: string,
): Promise<{ value: unknown; log?: string }> {
  switch (spec.kind) {
    case "static":
      return { value: spec.value };
    case "script": {
      const { stdout, stderr } = await run(String(spec.run), { cwd, windowsHide: true });
      const text = stdout.trim();
      try {
        return { value: JSON.parse(text), log: stderr || undefined };
      } catch {
        return { value: { text }, log: stderr || undefined };
      }
    }
    case "read-dir": {
      const exclude = Array.isArray(spec.exclude) ? spec.exclude.map(String) : [];
      return { value: { children: await readDir(String(spec.basePath), exclude) } };
    }
    default:
      throw new Error(`Коллектор ${String(spec.kind)} ещё не поддержан`);
  }
}

/**
 * Collectors write into `collect.json` next to the config. On failure the previous data
 * stays: the value was true once, we just could not refresh it — decision 0004.
 */
export async function collect(metric: MapMetric, cwd: string): Promise<Collected> {
  const specs = metric.config.collectors ?? [];
  const previous = await readCache(metric);

  try {
    const results = await Promise.all(specs.map((spec) => collector(spec, cwd)));
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
    await writeCache(metric, collected, log);
    return collected;
  } catch (error) {
    const failed: Collected = {
      updatedAt: new Date().toISOString(),
      ok: false,
      data: previous?.data,
    };
    await writeCache(metric, failed, error instanceof Error ? error.message : String(error));
    return failed;
  }
}

const cacheUri = (metric: MapMetric, file: string) =>
  vscode.Uri.joinPath(vscode.Uri.file(metric.configPath), "..", file);

export async function readCache(metric: MapMetric): Promise<Collected | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(cacheUri(metric, "collect.json"));
    return JSON.parse(new TextDecoder().decode(bytes)) as Collected;
  } catch {
    return undefined;
  }
}

async function writeCache(metric: MapMetric, value: Collected, log?: string): Promise<void> {
  await vscode.workspace.fs.writeFile(
    cacheUri(metric, "collect.json"),
    encode(JSON.stringify(value, null, 2) + "\n"),
  );
  // Logs explain a red dot; without them a failed run says only that it failed.
  if (log) {
    await vscode.workspace.fs.writeFile(cacheUri(metric, "collect.logs.json"), encode(log));
  }
}
