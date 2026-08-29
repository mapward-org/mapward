import { Observable } from "rxjs";
import * as vscode from "vscode";
import type { mapBridge } from "@/kernel/bridge/map.ts";
import type { BridgeHandlers } from "@/shared/bridge/contract.ts";
import { collect } from "../adapters/collect.ts";
import { readMap } from "../adapters/read-map.ts";
import { findMetric } from "../pure-model/model.ts";

/** Wiring only: every line names an adapter. */
export function mapObjectHandlers(): BridgeHandlers<typeof mapBridge> {
  return {
    getMap: (ref) => readMap(ref.mapPath, ref.basePath, ref.name),

    watchMap: (ref) =>
      new Observable((subscriber) => {
        const push = () =>
          void readMap(ref.mapPath, ref.basePath, ref.name).then((map) => subscriber.next(map));
        // The map is edited by hand and by agents, so the file system is the source of truth.
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(ref.mapPath), "**/*.json"),
        );
        watcher.onDidCreate(push);
        watcher.onDidChange(push);
        watcher.onDidDelete(push);
        push();
        return () => watcher.dispose();
      }),

    runMetric: async (params) => {
      const map = await readMap(params.mapPath, params.basePath, params.name);
      const metric = findMetric(map, params.metric);
      if (!metric) throw new Error(`Метрика ${params.metric} не найдена`);
      // Scripts run from the map root, as decision 0004 says.
      return collect(metric, params.mapPath);
    },
  };
}
