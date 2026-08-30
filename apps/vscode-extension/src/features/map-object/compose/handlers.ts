import { Observable } from "rxjs";
import * as vscode from "vscode";
import type { directiveBridge, mapBridge } from "@/kernel/bridge/map.ts";
import type { stateBridge } from "@/kernel/bridge/state.ts";
import type { BridgeHandlers } from "@/shared/bridge/contract.ts";
import { collect } from "../adapters/collect.ts";
import { createDirective } from "../adapters/directives.ts";
import { readMapState, viewState, writeMapState } from "../adapters/state.ts";
import { readMap } from "../adapters/read-map.ts";
import { findMetricOwner } from "../pure-model/model.ts";

/**
 * Files the extension writes itself: metric caches and node positions. A watcher that
 * reacted to them would re-read the map, re-collect the metrics and write again — the map
 * would never stand still, and nothing on screen would hold its state.
 */
const ourOwnWrite = (uri: { path: string }) =>
  /(collect|transform)(\.logs)?\.json$|map-state\.json$/.test(uri.path);

/** Wiring only: every line names an adapter. */
export function mapObjectHandlers(
  memento: import("vscode").Memento,
): BridgeHandlers<typeof mapBridge & typeof directiveBridge & typeof stateBridge> {
  const view = viewState(memento);

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
        const onChange = (uri: vscode.Uri) => {
          if (!ourOwnWrite(uri)) push();
        };
        watcher.onDidCreate(onChange);
        watcher.onDidChange(onChange);
        watcher.onDidDelete(onChange);
        push();
        return () => watcher.dispose();
      }),

    runMetric: async (params) => {
      const map = await readMap(params.mapPath, params.basePath, params.name);
      const found = findMetricOwner(map, params.metric);
      if (!found) throw new Error(`Метрика ${params.metric} не найдена`);
      // Scripts run from the map root, as decision 0004 says.
      return collect(found.metric, found.object, params.mapPath);
    },

    createDirective: (params) => createDirective(params),

    getViewState: (params) => view.get(params),
    setViewState: (params) => view.set(params),
    getMapState: (params) => readMapState(params),
    setMapState: (params) => writeMapState(params),
  };
}
