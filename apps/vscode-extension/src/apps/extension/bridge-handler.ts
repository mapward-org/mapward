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
import { runStage } from "./run-stage.ts";

/**
 * Где фичи встречаются с мостом. Ниже apps никто не решает, что отвечает хост.
 *
 * Открытие таба приходит параметром, а не импортом: панели заводит тот, кто ими владеет, и из
 * таба открывается такой же таб — без этого мост и панели ссылались бы друг на друга (0026).
 */
export function serveBridge(
  server: MapServer,
  webview: vscode.Webview,
  memento: vscode.Memento,
  openTab: (target: {
    mapPath: string;
    basePath: string;
    name: string;
    address: string;
    group?: string;
    metric?: string;
  }) => Promise<void>,
): () => void {
  const handlers: BridgeHandlers<AppBridge> = {
    ...mapsHandlers(),

    getCapabilities: () => server.capabilities(),
    getMap: (ref) => server.getMap(ref),
    watchMap: (ref) => server.watchMap(ref),
    reloadMap: (ref) => server.reloadMap(ref),
    watchMetrics: (params) => server.watchMetrics(params),
    watchDisplay: (params) => server.watchDisplay(params),
    runMetric: (params) => server.runMetric(params),

    /** Тот же объект во всю ширину редактора — решение 0026. */
    openInTab: (params) => openTab(params),

    /** Кто ждёт ответа — список держит сервер, мост его только передаёт (решение 0034). */
    watchTurns: () => server.watchTurns(),
    dismissTurn: (params) => server.dismissTurn(params),

    /** Экшоны и прогоны — решение 0038: запуск, остановка и история объекта у сервера. */
    runAction: (params) => server.runAction(params),
    stopRun: (params) => server.stopRun(params),
    watchRuns: (params) => server.watchRuns(params),

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

    /**
     * Спрашивает редактор, удаляет сервер. Вопрос здесь обязателен: крестик стоит в ряду с
     * названием, и промахнуться по нему — обычное дело.
     */
    deleteDirective: async (params) => {
      const yes = "Удалить";
      const answer = await vscode.window.showWarningMessage(
        `Удалить директиву ${params.directive}?`,
        { modal: true, detail: "Вместе с ней уйдёт состояние её прогонов." },
        yes,
      );
      if (answer !== yes) return { deleted: false };
      return server.deleteDirective(params);
    },

    openObjectTerminal: async (params) => {
      const map = await server.getMap(params);
      const object = findObject(map, params.address) ?? map;
      // Терминал на объект, а не на директиву — решение 0017: директив у объекта много,
      // этапов у каждой несколько, и всё это греет один контекст.
      // Открывается в корне проекта: директива может тронуть что угодно в репозитории.
      return openTerminal({
        name: `mapward: ${object.name}`,
        address: params.address,
        cwd: params.basePath,
        prompt: objectPrompt(object, params.mapPath),
        fresh: params.fresh,
      });
    },

    /** Кнопка этапа на карте — тот же вызов, что у кнопок в файле директивы (0032). */
    runStage: (params) => runStage(server, params),

    showTerminal: (params) => showTerminal(params),
    listTerminals: (params) => listTerminals(params),
    closeTerminal: (params) => closeTerminal(params),
  };

  return createBridgeServer(appBridge, webviewTransport(webview), handlers);
}
