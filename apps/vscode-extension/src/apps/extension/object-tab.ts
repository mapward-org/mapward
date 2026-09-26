import * as vscode from "vscode";
import { findObject } from "@mapward/core";
import type { MapServer } from "@mapward/abstract-server";
import type { TabTarget } from "@mapward/abstract-react-client";
import { serveBridge } from "./bridge-handler.ts";
import { webviewHtml } from "./webview-html.ts";
import type { ShownTabs } from "@/features/object-focus/index.extension.ts";

/**
 * Объект отдельным табом — решение 0026.
 *
 * Таб — второй вид того же сервера, а не второе приложение: стор метрик один на окно, и таб
 * видит то же, что сайдбар, включая идущий прогон (решение 0013). Своего здесь только окно:
 * панель, её заголовок и восстановление после перезапуска.
 */
const VIEW_TYPE = "mapward.object";

/** Где таб: объект и, у таба метрики, её ключ. Вкладка объекта на имя не влияет. */
type Place = Pick<TabTarget, "mapPath" | "basePath" | "name" | "address" | "metric">;

/**
 * Заголовок читается из карты: в нём имя объекта, а у таба метрики — ещё и её подпись. Считается
 * при открытии и при каждом переходе в табе: имя показывает то, что на экране.
 */
async function titleOf(server: MapServer, target: Place): Promise<string> {
  const map = await server.getMap(target);
  const object = findObject(map, target.address) ?? map;
  if (target.metric === undefined) return object.name;

  const metric = object.metrics.find((entry) => entry.key === target.metric);
  return `${object.name}: ${metric?.config.label ?? target.metric}`;
}

/** Что вкладки показывают сейчас — по нему кнопка «к объекту» находит вкладку. */
export type Tabs = ShownTabs<vscode.WebviewPanel>;

/**
 * На каком объекте таб стоит сейчас. У вернувшегося после перезагрузки это не адрес, на котором
 * его открыли, а текущий шаг сохранённой истории: шаг — строка экрана, адрес в ней до `?`.
 */
const shownAddress = (target: TabTarget): string => {
  const entry = target.history?.entries[target.history.index];
  return entry?.split("?")[0] ?? target.address;
};

function attach(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  server: MapServer,
  tabs: Tabs,
  target: TabTarget,
): void {
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
  };
  panel.webview.html = webviewHtml(panel.webview, context.extensionUri, target);

  // Переходы бывают быстрее чтения карты: имя ставит только последний из них.
  let latest = 0;
  let disposed = false;
  // В список таб попадает сразу, не дожидаясь вебвью: вкладка на заднем плане после
  // перезагрузки может молчать, пока на неё не переключатся.
  tabs.show(panel, { mapPath: target.mapPath, address: shownAddress(target) });
  if (panel.active) tabs.activate(panel);
  panel.onDidChangeViewState(() => {
    if (panel.active) tabs.activate(panel);
  });
  const showing = async (place: Place): Promise<void> => {
    if (!disposed) tabs.show(panel, place);
    const turn = ++latest;
    const title = await titleOf(server, place);
    if (turn === latest && !disposed) panel.title = title;
  };

  // Из таба открывается такой же таб: ctrl + клик работает везде одинаково.
  const stop = serveBridge(
    server,
    panel.webview,
    context.workspaceState,
    (next) => openObjectTab(context, server, tabs, next),
    showing,
  );
  panel.onDidDispose(() => {
    disposed = true;
    tabs.close(panel);
    stop();
  });
}

export async function openObjectTab(
  context: vscode.ExtensionContext,
  server: MapServer,
  tabs: Tabs,
  target: TabTarget,
): Promise<void> {
  // Каждое открытие — новый таб, даже на уже открытом объекте: таб уходит переходами куда
  // угодно, и «тот же таб» определить не по чему (решение 0026).
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    await titleOf(server, target),
    vscode.ViewColumn.Active,
    // Таб держит, на чём он открыт, и продолжает собирать метрики открытой вкладки, пока его
    // не закрыли: уход на соседний таб — это не закрытие вида.
    { retainContextWhenHidden: true },
  );
  attach(panel, context, server, tabs, target);
}

/**
 * После перезапуска окна редактор возвращает свои табы сам, и наш должен вернуться вместе с
 * ними: иначе разложенные рядом карта и код переживают перезапуск наполовину.
 *
 * На чём таб был открыт, помнит сам вебвью — он кладёт `target` в своё состояние, а редактор
 * отдаёт его обратно. Состояния нет — таб был открыт старой версией расширения, и восстановить
 * его нечем: он закрывается, а не показывает пустоту.
 */
export function registerObjectTabs(
  context: vscode.ExtensionContext,
  server: MapServer,
  tabs: Tabs,
): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
    deserializeWebviewPanel: (panel, state: unknown) => {
      const target = state as TabTarget | undefined;
      if (typeof target?.address !== "string" || typeof target.mapPath !== "string") {
        panel.dispose();
        return Promise.resolve();
      }
      attach(panel, context, server, tabs, target);
      return Promise.resolve();
    },
  });
}
