import * as vscode from "vscode";
import type { MapsState, ResolvedMap } from "../../../kernel/bridge/config.ts";
import { CONFIG_FILE, ConfigError, mapName, parseConfig } from "../pure-model/config.ts";

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** Up from a folder to the file system root, first hit wins — the same way git looks. */
async function findConfig(from: vscode.Uri): Promise<vscode.Uri | undefined> {
  let current = from;
  for (;;) {
    const candidate = vscode.Uri.joinPath(current, CONFIG_FILE);
    // Sequential on purpose: we climb until the first hit and stop, not gather everything.
    // oxlint-disable-next-line no-await-in-loop
    if (await readText(candidate)) return candidate;
    const parent = vscode.Uri.joinPath(current, "..");
    if (parent.path === current.path) return undefined;
    current = parent;
  }
}

async function mapsOfConfig(configUri: vscode.Uri): Promise<ResolvedMap[]> {
  const text = await readText(configUri);
  if (!text) return [];

  const configDir = vscode.Uri.joinPath(configUri, "..");
  return parseConfig(text).map((entry) => {
    const mapPath = vscode.Uri.joinPath(configDir, entry.mapUrl).fsPath;
    return {
      name: mapName(mapPath),
      mapPath,
      basePath: vscode.Uri.joinPath(configDir, entry.baseUrl).fsPath,
      configPath: configUri.fsPath,
    };
  });
}

/**
 * The editor has no cwd, so the search starts from every workspace folder. Two folders of one
 * monorepo climb to the same config, and two configs may point at one map — hence the dedup
 * by map path rather than by config.
 */
export async function readMaps(): Promise<MapsState> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return { kind: "no-workspace" };

  const seen = new Set<string>();
  const maps: ResolvedMap[] = [];
  let failure: ConfigError | undefined;

  for (const folder of folders) {
    // oxlint-disable-next-line no-await-in-loop
    const configUri = await findConfig(folder.uri);
    if (!configUri) continue;
    try {
      // oxlint-disable-next-line no-await-in-loop
      for (const map of await mapsOfConfig(configUri)) {
        if (seen.has(map.mapPath)) continue;
        seen.add(map.mapPath);
        maps.push(map);
      }
    } catch (error) {
      if (error instanceof ConfigError) failure ??= error;
      else throw error;
    }
  }

  // A broken config is worth shouting about, but only when nothing else was found —
  // one bad file in a multi-root workspace should not hide the maps that do work.
  if (maps.length === 0 && failure) throw failure;
  return maps.length === 0 ? { kind: "no-config" } : { kind: "maps", maps };
}
