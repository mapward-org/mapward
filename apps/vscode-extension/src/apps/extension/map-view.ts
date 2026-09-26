import * as vscode from "vscode";
import type { MapServer } from "@mapward/abstract-server";
import type { FocusRequests } from "@/features/object-focus/index.extension.ts";
import { serveBridge } from "./bridge-handler.ts";
import { webviewHtml } from "./webview-html.ts";

/**
 * The map lives in the sidebar, where the file tree usually is: the map is the way into the
 * project, files are the details you go down to.
 */
export class MapViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "mapward.map";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly memento: vscode.Memento,
    private readonly server: MapServer,
    /** Открыть объект табом — панелями владеет `object-tab`, сайдбар только просит (0026). */
    private readonly openTab: (target: {
      mapPath: string;
      basePath: string;
      name: string;
      address: string;
      group?: string;
      metric?: string;
    }) => Promise<void>,
    /** Куда перейти по кнопке «к объекту» — решает хост, сайдбар только слушает. */
    private readonly focus: FocusRequests,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = webviewHtml(view.webview, this.extensionUri);

    const stop = serveBridge(this.server, view.webview, this.memento, this.openTab, undefined, () =>
      this.focus.watch(),
    );

    // Число «ждут ответа» на иконке карты в левой полосе: его видно и при закрытом сайдбаре
    // (решение 0034). Поставить его можно только у созданного вида — пока карту в окне ни разу
    // не открывали, числа нет. Вид закрылся — подписка уходит вместе с ним.
    const turns = this.server.watchTurns().subscribe((list) => {
      view.badge =
        list.length === 0
          ? undefined
          : { value: list.length, tooltip: `Ждут ответа: ${list.length}` };
    });
    view.onDidDispose(() => {
      turns.unsubscribe();
      stop();
    });
  }
}
