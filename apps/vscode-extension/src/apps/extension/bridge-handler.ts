import * as vscode from "vscode";
import { appBridge, findObject, type BridgeHandlers } from "@mapward/core";
import type { AppBridge } from "@mapward/core";
import { objectPrompt } from "@mapward/abstract-server";
import type { MapServer } from "@mapward/abstract-server";
import { mapsHandlers } from "@/features/maps/index.extension.ts";
import { createBridgeServer } from "@mapward/core";
import { webviewTransport } from "@/shared/bridge/transport.ts";
import {
  closeTerminal,
  listTerminals,
  openTerminal,
  showTerminal,
} from "@/features/terminals/index.extension.ts";

/** Где фичи встречаются с мостом. Ниже apps никто не решает, что отвечает хост. */
export function serveBridge(
  server: MapServer,
  webview: vscode.Webview,
  memento: vscode.Memento,
): () => void {
  const handlers: BridgeHandlers<AppBridge> = {
    ...mapsHandlers(),

    getCapabilities: () => server.capabilities(),
    getMap: (ref) => server.getMap(ref),
    watchMap: (ref) => server.watchMap(ref),
    watchMetrics: (params) => server.watchMetrics(params),
    runMetric: (params) => server.runMetric(params),

    getMapState: (params) => server.getMapState(params),
    setMapState: (params) => server.setMapState(params),

    // Хранилище редактора: у каждого человека своё, в репозиторий не попадает.
    getViewState: (params) => memento.get(params.key),
    setViewState: async (params) => {
      await memento.update(params.key, params.value);
    },

    /** Имя спрашивает редактор, файл пишет сервер, открывает снова редактор. */
    createDirective: async (params) => {
      const title = await vscode.window.showInputBox({
        title: "Новая директива",
        prompt: "О чём она — это станет именем файла",
        placeHolder: "например, add feature terminals",
      });
      if (!title) return { path: "" };

      const created = await server.createDirective({ objectPath: params.objectPath, title });
      await vscode.window.showTextDocument(vscode.Uri.file(created.path));
      return created;
    },

    openObjectTerminal: async (params) => {
      const map = await server.getMap(params);
      const object = findObject(map, params.address) ?? map;
      // Терминал на объект, а не на директиву — решение 0017: директив у объекта много,
      // этапов у каждой несколько, и всё это греет один контекст.
      // Открывается в корне проекта: директива может тронуть что угодно в репозитории.
      return openTerminal({
        name: `mapward: ${object.name}`,
        cwd: params.basePath,
        prompt: objectPrompt(object, params.mapPath),
        fresh: params.fresh,
      });
    },

    showTerminal: (params) => showTerminal(params),
    listTerminals: () => listTerminals({ prefix: "mapward: " }),
    closeTerminal: (params) => closeTerminal(params),
  };

  return createBridgeServer(appBridge, webviewTransport(webview), handlers);
}
