import * as vscode from "vscode";
import { bridgeToWebview } from "../../shared/bridge/extension.ts";

/**
 * The map lives in the sidebar, where the file tree usually is: the map is the way into the
 * project, files are the details you go down to.
 */
export class MapViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "mapward.map";

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = this.html(view.webview);

    const bridge = bridgeToWebview(view.webview);
    bridge.onMessage((message) => {
      if (message.kind === "ping") bridge.post({ kind: "pong", at: new Date().toISOString() });
    });
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", name));
    // A nonce lets our own script run while the CSP keeps everything else out.
    const nonce = Array.from({ length: 32 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
        Math.floor(Math.random() * 62),
      ),
    ).join("");

    return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${asset("webview.css")}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${asset("webview.mjs")}"></script>
  </body>
</html>`;
  }
}
