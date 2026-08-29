import { Observable } from "rxjs";
import * as vscode from "vscode";
import type { MapsState, ResolvedMap } from "@/kernel/bridge/config.ts";
import {
  CONFIG_FILE,
  INDEX_FILE,
  mapName,
  parseConfig,
} from "@/features/maps/pure-model/config.ts";

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
  return Promise.all(
    parseConfig(text).map(async (entry) => {
      const mapUri = vscode.Uri.joinPath(configDir, entry.mapUrl);
      const index = await readText(vscode.Uri.joinPath(mapUri, INDEX_FILE));
      return {
        name: mapName(index, mapUri.fsPath),
        mapPath: mapUri.fsPath,
        basePath: vscode.Uri.joinPath(configDir, entry.baseUrl).fsPath,
        configPath: configUri.fsPath,
      };
    }),
  );
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
  let failure: { message: string; configPath: string } | undefined;

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
      failure ??= {
        message: error instanceof Error ? error.message : String(error),
        configPath: configUri.fsPath,
      };
    }
  }

  // A broken config is a state, not a crash: thrown from a stream it would leave the
  // sidebar spinning forever. Reported only when nothing else was found — one bad file in
  // a multi-root workspace should not hide the maps that do work.
  if (maps.length === 0 && failure) return { kind: "error", ...failure };
  return maps.length === 0 ? { kind: "no-config" } : { kind: "maps", maps };
}

/**
 * Configs are edited by hand and by agents, so the file system is the source of truth, not
 * our own writes. Folder changes count too: a workspace root added or dropped changes which
 * maps exist.
 */
export function watchMaps(): Observable<MapsState> {
  return new Observable((subscriber) => {
    const push = () => void readMaps().then((state) => subscriber.next(state));

    const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE}`);
    const folders = vscode.workspace.onDidChangeWorkspaceFolders(push);
    watcher.onDidCreate(push);
    watcher.onDidChange(push);
    watcher.onDidDelete(push);
    push();

    return () => {
      watcher.dispose();
      folders.dispose();
    };
  });
}
