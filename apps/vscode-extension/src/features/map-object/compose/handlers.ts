import { Observable } from "rxjs";
import * as vscode from "vscode";
import type { directiveBridge, mapBridge, terminalBridge } from "@/kernel/bridge/map.ts";
import type { stateBridge } from "@/kernel/bridge/state.ts";
import type { BridgeHandlers } from "@/shared/bridge/contract.ts";
import { collect } from "../adapters/collect.ts";
import { createDirective } from "../adapters/directives.ts";
import { closeTerminal, listTerminals, openTerminal } from "../adapters/terminals.ts";
import { directivePrompt, objectPrompt } from "../pure-model/prompts.ts";
import { findObject } from "../pure-model/model.ts";
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
): BridgeHandlers<
  typeof mapBridge & typeof directiveBridge & typeof terminalBridge & typeof stateBridge
> {
  const view = viewState(memento);

  return {
    getMap: (ref) => readMap(ref.mapPath, ref.basePath, ref.name),

    watchMap: (ref) =>
      new Observable((subscriber) => {
        const push = () =>
          void readMap(ref.mapPath, ref.basePath, ref.name).then((map) => subscriber.next(map));
        // The map is edited by hand and by agents, so the file system is the source of truth.
        // Markdown counts as the map too: directives and actions are `.md`, and a directive's
        // status is read from its text — a json-only watcher left a fresh directive out of the
        // list until something else happened to touch a json.
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(ref.mapPath), "**/*.{json,md}"),
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

    openObjectTerminal: async (params) => {
      const map = await readMap(params.mapPath, params.basePath, params.name);
      const object = findObject(map, params.address) ?? map;
      // The terminal opens at the project root: a directive may touch anything in the repo.
      return openTerminal({
        name: `mapward: ${object.name}`,
        cwd: params.basePath,
        prompt: objectPrompt(object, params.mapPath),
        fresh: params.fresh,
      });
    },

    runDirective: async (params) => {
      const map = await readMap(params.mapPath, params.basePath, params.name);
      const object = findObject(map, params.address) ?? map;
      const file = params.directive.replaceAll("\\\\", "/").split("/").at(-1) ?? params.directive;
      // One terminal per directive: check, dry run and run warm the same context.
      return openTerminal({
        name: `mapward: ${file}`,
        cwd: params.basePath,
        prompt: directivePrompt(params.mode, params.directive, object, params.mapPath),
        fresh: params.fresh,
      });
    },

    listTerminals: () => listTerminals({ prefix: "mapward: " }),
    closeTerminal: (params) => closeTerminal(params),

    getViewState: (params) => view.get(params),
    setViewState: (params) => view.set(params),
    getMapState: (params) => readMapState(params),
    setMapState: (params) => writeMapState(params),
  };
}
