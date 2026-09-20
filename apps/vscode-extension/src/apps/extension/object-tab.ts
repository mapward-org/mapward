import * as vscode from "vscode";
import { findObject } from "@mapward/core";
import type { MapServer } from "@mapward/abstract-server";
import type { TabTarget } from "@mapward/abstract-react-client";
import { serveBridge } from "./bridge-handler.ts";
import { webviewHtml } from "./webview-html.ts";

/**
 * Объект отдельным табом — решение 0026.
 *
 * Таб — второй вид того же сервера, а не второе приложение: стор метрик один на окно, и таб
 * видит то же, что сайдбар, включая идущий прогон (решение 0013). Своего здесь только окно:
 * панель, её заголовок и восстановление после перезапуска.
 */
const VIEW_TYPE = "mapward.object";

/** Открытые табы по тому, на чём они открыты: повторное открытие того же поднимает панель. */
const panels = new Map<string, vscode.WebviewPanel>();

const keyOf = (target: TabTarget): string =>
  [target.mapPath, target.address, target.group ?? "", target.metric ?? ""].join("|");

/** Заголовок читается из карты: в нём имя объекта, а у таба метрики — ещё и её подпись. */
async function titleOf(server: MapServer, target: TabTarget): Promise<string> {
  const map = await server.getMap(target);
  const object = findObject(map, target.address) ?? map;
  if (target.metric === undefined) return object.name;

  const metric = object.metrics.find((entry) => entry.key === target.metric);
  return `${object.name}: ${metric?.config.label ?? target.metric}`;
}

function attach(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  server: MapServer,
  target: TabTarget,
): void {
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
  };
  panel.webview.html = webviewHtml(panel.webview, context.extensionUri, target);

  // Из таба открывается такой же таб: ctrl + клик работает везде одинаково.
  const stop = serveBridge(server, panel.webview, context.workspaceState, (next) =>
    openObjectTab(context, server, next),
  );
  const key = keyOf(target);
  panels.set(key, panel);
  panel.onDidDispose(() => {
    stop();
    if (panels.get(key) === panel) panels.delete(key);
  });
}

export async function openObjectTab(
  context: vscode.ExtensionContext,
  server: MapServer,
  target: TabTarget,
): Promise<void> {
  // Тот же объект в той же вкладке — это тот же таб: иначе ctrl + клик по одному и тому же
  // копит одинаковые панели, а состояние метрик у них общее, и отличить их нечем.
  const existing = panels.get(keyOf(target));
  if (existing) {
    existing.reveal();
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    await titleOf(server, target),
    vscode.ViewColumn.Active,
    // Таб держит, на чём он открыт, и продолжает собирать метрики открытой вкладки, пока его
    // не закрыли: уход на соседний таб — это не закрытие вида.
    { retainContextWhenHidden: true },
  );
  attach(panel, context, server, target);
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
): vscode.Disposable {
  return vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
    deserializeWebviewPanel: (panel, state: unknown) => {
      const target = state as TabTarget | undefined;
      if (typeof target?.address !== "string" || typeof target.mapPath !== "string") {
        panel.dispose();
        return Promise.resolve();
      }
      attach(panel, context, server, target);
      return Promise.resolve();
    },
  });
}
