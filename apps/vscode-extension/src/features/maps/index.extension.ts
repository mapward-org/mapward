import { Observable } from "rxjs";
import * as vscode from "vscode";
import type { BridgeHandlers } from "../../shared/bridge/contract.ts";
import type { ConfigBridge } from "../../kernel/bridge/config.ts";
import { createConfig, pickFolder } from "./adapters/editor.ts";
import { readMaps } from "./adapters/workspace.ts";

export function mapsHandlers(): BridgeHandlers<ConfigBridge> {
  return {
    getMaps: () => readMaps(),
    createConfig: () => createConfig(),
    pickFolder: () => pickFolder(),
    watchMaps: () =>
      new Observable((subscriber) => {
        const push = () => void readMaps().then((state) => subscriber.next(state));
        // Configs are edited by hand and by agents, so watch the files, not our own writes.
        const watcher = vscode.workspace.createFileSystemWatcher(`**/mapward.json`);
        const folders = vscode.workspace.onDidChangeWorkspaceFolders(push);
        watcher.onDidCreate(push);
        watcher.onDidChange(push);
        watcher.onDidDelete(push);
        push();
        return () => {
          watcher.dispose();
          folders.dispose();
        };
      }),
  };
}
