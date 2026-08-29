import * as vscode from "vscode";
import type { MapsState } from "../../../kernel/bridge/config.ts";
import { CONFIG_FILE, EMPTY_CONFIG } from "../pure-model/config.ts";
import { readMaps } from "./workspace.ts";

/** Writes a starting config into the first workspace folder and opens it for editing. */
export async function createConfig(): Promise<MapsState> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return { kind: "no-workspace" };

  const uri = vscode.Uri.joinPath(folder.uri, CONFIG_FILE);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(EMPTY_CONFIG));
  await vscode.window.showTextDocument(uri);
  return readMaps();
}

/**
 * Opens a folder as the workspace rather than letting the user point at a `mapward.json`
 * directly: a map outside the workspace would resolve its file links nowhere.
 */
export async function pickFolder(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Открыть проект",
  });
  if (picked?.[0]) await vscode.commands.executeCommand("vscode.openFolder", picked[0]);
}
