import * as vscode from "vscode";
import type { TabTarget } from "@mapward/abstract-react-client";

/**
 * Страница вебвью — одна на сайдбар и на таб (решение 0026). Различает их только `target`:
 * с ним клиент открывается на объекте, без него показывает карты списком.
 */
export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  target?: TabTarget,
): string {
  const asset = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", name));
  // A nonce lets our own script run while the CSP keeps everything else out.
  const nonce = Array.from({ length: 32 }, () =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
      Math.floor(Math.random() * 62),
    ),
  ).join("");

  // `unsafe-eval` — ради дисплея-компонента метрики (решение 0037): его код собирает сервер и
  // приносит строкой, а выполнить строку без этого разрешения нельзя. Код карты свой: его пишет
  // автор карты или её агент, как и скрипты метрик, которые и так идут в оболочке.
  // Адрес уезжает в страницу значением, а не вызовом: скрипту вебвью неоткуда спросить, на чём
  // его открыли, а `postMessage` следом означал бы кадр с пустым экраном перед первым ответом.
  const startup =
    target === undefined
      ? ""
      : `<script nonce="${nonce}">window.__mapwardTarget = ${JSON.stringify(target).replaceAll(
          "<",
          "\\u003c",
        )};</script>`;

  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';" />
    <link rel="stylesheet" href="${asset("webview.css")}" />
    <style nonce="${nonce}">
      @font-face {
        font-family: codicon;
        src: url("${asset("codicon.ttf")}") format("truetype");
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    ${startup}
    <script type="module" nonce="${nonce}" src="${asset("webview.mjs")}"></script>
  </body>
</html>`;
}
