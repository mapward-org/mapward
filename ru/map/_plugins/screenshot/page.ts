import { readFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";

/**
 * Страница для безголового браузера: та же сборка вебвью, что в редакторе, на маленьком http
 * своего процесса. Вебвью говорит с редактором через `acquireVsCodeApi().postMessage` и событие
 * `message` окна — здесь их подменяет прокладка: сообщения уходят `POST /bridge`, ответы приходят
 * потоком событий `GET /bridge`, а `/bridge` проксируется на мост платформы. Свой адрес у моста
 * один на страницу (сессия), поэтому страниц можно открыть сколько угодно.
 */

/** Что вебвью открывает: тот же адрес, что у таба объекта (решение 0026). */
export type PageTarget = {
  mapPath: string;
  basePath: string;
  name: string;
  address: string;
  group?: string;
  metric?: string;
  /**
   * Перекрытия на этот снимок: состояние вида (`viewState`, `expand: "all"`) и `params` метрики.
   * Клиент читает их со страницы и в хранилище человека ничего не пишет.
   */
  snapshot?: {
    viewState?: Record<string, unknown>;
    expand?: "all";
    params?: Record<string, unknown>;
  };
};

/** Файлы сборки вебвью, которые страница берёт; остального наружу не отдаём. */
const ASSETS: Record<string, string> = {
  "/webview.mjs": "text/javascript; charset=utf-8",
  "/webview.css": "text/css; charset=utf-8",
  "/codicon.ttf": "font/ttf",
};

/**
 * Тема — переменные `--vscode-*`, которые в вебвью подставляет редактор. Здесь редактора нет, и
 * подставляется тёмная тема VS Code по умолчанию (Dark Modern): цвета своей темы человека
 * снаружи редактора не узнать.
 */
const DARK: Record<string, string> = {
  "activityBarBadge-background": "#0078d4",
  "activityBarBadge-foreground": "#ffffff",
  "button-background": "#0078d4",
  "button-foreground": "#ffffff",
  "button-hoverBackground": "#026ec1",
  "charts-blue": "#3794ff",
  "charts-green": "#89d185",
  "charts-yellow": "#cca700",
  descriptionForeground: "#9d9d9d",
  "editor-background": "#1f1f1f",
  errorForeground: "#f85149",
  focusBorder: "#0078d4",
  "font-family": '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif',
  "font-size": "13px",
  foreground: "#cccccc",
  "gitDecoration-addedResourceForeground": "#81b88b",
  "gitDecoration-conflictingResourceForeground": "#e4676b",
  "gitDecoration-deletedResourceForeground": "#c74e39",
  "gitDecoration-modifiedResourceForeground": "#e2c08d",
  "gitDecoration-untrackedResourceForeground": "#73c991",
  "input-background": "#313131",
  "input-border": "#3c3c3c",
  "input-foreground": "#cccccc",
  "list-activeSelectionBackground": "#04395e",
  "list-hoverBackground": "#2a2d2e",
  "menu-background": "#1f1f1f",
  "menu-border": "#454545",
  "panel-border": "#2b2b2b",
  "scrollbarSlider-activeBackground": "#bfbfbf66",
  "scrollbarSlider-background": "#79797966",
  "scrollbarSlider-hoverBackground": "#646464b3",
  "sideBar-background": "#181818",
  "testing-iconFailed": "#f14c4c",
  "testing-iconPassed": "#73c991",
  "testing-iconQueued": "#cca700",
  "textBlockQuote-background": "#2b2b2b",
  "textBlockQuote-border": "#616161",
  "textLink-foreground": "#4daafc",
};

const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

/** Прокладка вместо `acquireVsCodeApi` редактора: мост поверх http своего же сервера. */
const SHIM = `
(() => {
  const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const url = "/bridge?session=" + session;
  let api;
  window.acquireVsCodeApi = () => {
    if (api) return api;
    const events = new EventSource(url);
    events.onmessage = (event) => window.postMessage(JSON.parse(event.data), "*");
    let state;
    api = {
      postMessage: (message) =>
        void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message) }),
      getState: () => state,
      setState: (value) => (state = value),
    };
    return api;
  };
})();`;

export function pageHtml(target: PageTarget): string {
  const theme = Object.entries(DARK)
    .map(([name, value]) => `--vscode-${name}: ${value};`)
    .join(" ");
  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/webview.css" />
    <style>
      @font-face { font-family: codicon; src: url("/codicon.ttf") format("truetype"); }
      html { ${theme} }
      body { margin: 0; padding: 0 20px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>${SHIM}</script>
    <script>window.__mapwardTarget = ${json(target)};</script>
    <script type="module" src="/webview.mjs"></script>
  </body>
</html>`;
}

export type PageServer = { url: string; close(): Promise<void> };

/** Запрос `/bridge` — к мосту платформы как есть, поток событий тоже: ответ течёт насквозь. */
function proxy(bridge: string, request: IncomingMessage, response: ServerResponse): void {
  const from = new URL(request.url ?? "/", "http://127.0.0.1");
  const to = new URL(bridge);
  to.search = from.search;
  const outgoing = httpRequest(
    to,
    { method: request.method, headers: { "content-type": request.headers["content-type"] ?? "" } },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  outgoing.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502);
    response.end(`мост платформы не отвечает: ${error.message}`);
  });
  response.on("close", () => outgoing.destroy());
  request.pipe(outgoing);
}

/** Сервер страницы на случайном порту петли: снаружи машины его не видно. */
export function servePage(params: {
  assets: string;
  bridge: string;
  target: PageTarget;
}): Promise<PageServer> {
  const html = pageHtml(params.target);
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/bridge") {
      proxy(params.bridge, request, response);
      return;
    }
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
      return;
    }
    const type = ASSETS[path];
    if (!type) {
      response.writeHead(404).end();
      return;
    }
    readFile(join(params.assets, path.slice(1))).then(
      (body) => response.writeHead(200, { "content-type": type }).end(body),
      () => response.writeHead(404).end(),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${String(port)}/`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
