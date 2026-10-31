import * as vscode from "vscode";
import { NEVER, type Observable } from "rxjs";
import { appBridge, MAP_ROOT, type BridgeHandlers } from "@mapward/core";
import type { AppBridge } from "@mapward/core";
import { objectPrompt } from "@mapward/abstract-server";
import type { MapServer } from "@mapward/abstract-server";
import { mapsHandlers } from "@/features/maps/index.extension.ts";
import { createBridgeServer } from "@mapward/core";
import { webviewTransport, type WebviewLike } from "@/shared/bridge/transport.ts";
import {
  closeDirectiveTerminals,
  closeTerminal,
  listTerminals,
  openTerminal,
  showDirectiveTerminal,
  showTerminal,
} from "@/features/terminals/index.extension.ts";
import { runStage } from "./run-stage.ts";
import { openPath } from "@/features/maps/index.extension.ts";
import { isDirectivePath, openDirective } from "@/features/directive-layout/index.extension.ts";

/**
 * Где фичи встречаются с мостом. Ниже apps никто не решает, что отвечает хост.
 *
 * Открытие таба приходит параметром, а не импортом: панели заводит тот, кто ими владеет, и из
 * таба открывается такой же таб — без этого мост и панели ссылались бы друг на друга (0026).
 * Так же приходит и `showing`: имя вкладки знает только панель, а у сайдбара её нет вовсе. И
 * `focus` — просьбы «перейди к объекту» слушает только сайдбар: таб хост поднимает сам.
 */
export function serveBridge(
  server: MapServer,
  webview: WebviewLike,
  memento: vscode.Memento,
  openTab: (target: {
    mapPath: string;
    basePath: string;
    name: string;
    address: string;
    group?: string;
    metric?: string;
  }) => Promise<void>,
  showing: (place: {
    mapPath: string;
    basePath: string;
    name: string;
    address: string;
    metric?: string;
  }) => Promise<void> = () => Promise.resolve(),
  focus: () => Observable<{ mapPath: string; address: string }> = () => NEVER,
): () => void {
  const handlers: BridgeHandlers<AppBridge> = {
    ...mapsHandlers(),

    /** Директива открывается в своей зоне — справа сверху, остальные файлы — в центре. */
    openPath: (params) =>
      isDirectivePath(params.path) ? openDirective(params.path) : openPath(params),

    getCapabilities: () => server.capabilities(),
    reloadMap: (ref) => server.reloadMap(ref),
    watchObject: (params) => server.watchObject(params),
    watchAncestors: (params) => server.watchAncestors(params),
    watchComponent: (params) => server.watchComponent(params),
    watchLayout: (params) => server.watchLayout(params),
    watchActionForm: (params) => server.watchActionForm(params),

    /** Компонент метрики зовёт свой плагин: процесс плагина живёт у платформы, мост — проводник. */
    callPlugin: (params) => server.watchPluginCall(params),
    describePlugin: (params) => server.describePlugin(params),

    /** Тот же объект во всю ширину редактора — решение 0026. */
    openInTab: (params) => openTab(params),
    showingInTab: (params) => showing(params),
    watchFocus: () => focus(),

    /** Кто ждёт ответа — список держит сервер, мост его только передаёт (решение 0034). */
    watchTurns: () => server.watchTurns(),
    dismissTurn: (params) => server.dismissTurn(params),

    /** Правка карты — базовый набор платформы: интерфейсу она нужна сама, как агенту и плагинам. */
    editMap: (params) => server.editMap(params),
    undoEdit: (params) => server.undoEdit(params),
    redoEdit: (params) => server.redoEdit(params),

    /** Экшоны и прогоны — решение 0038: запуск, остановка и история объекта у сервера. */
    runAction: (params) => server.runAction(params),
    stopRun: (params) => server.stopRun(params),
    watchRuns: (params) => server.watchRuns(params),

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
      await openDirective(created.path);
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
        { modal: true, detail: "Файл уйдёт в корзину, терминал директивы закроется." },
        yes,
      );
      if (answer !== yes) return { deleted: false };
      const result = await server.deleteDirective(params);
      if (result.deleted) {
        await closeDirectiveTerminals(`${params.objectPath}/_directives/${params.directive}`, {
          forget: true,
        });
      }
      return result;
    },

    openObjectTerminal: async (params) => {
      const object =
        (await server.readObject({ ...params, depth: 0 })) ??
        (await server.readObject({ ...params, address: MAP_ROOT, depth: 0 }));
      if (!object) throw new Error(`Объект ${params.address} не найден`);
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
    showDirectiveTerminal: (params) => showDirectiveTerminal(params),
    listTerminals: (params) => listTerminals(params),
    closeTerminal: (params) => closeTerminal(params),
  };

  return createBridgeServer(appBridge, webviewTransport(webview), handlers);
}
