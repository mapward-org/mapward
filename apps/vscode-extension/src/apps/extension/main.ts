import { statSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { bundleBuild, createMapServer, parseSettings, serveMcp } from "@mapward/abstract-server";
import type { MapServer, Settings, WebviewPort } from "@mapward/abstract-server";
import { readMaps, registerVirtualDocs } from "@/features/maps/index.extension.ts";
import { createPorts } from "./ports/index.ts";
import { MapViewProvider } from "./map-view.ts";
import { openObjectTab, registerObjectTabs } from "./object-tab.ts";
import { startMcpHttp } from "./mcp-http.ts";
import { bridgeHttp } from "./bridge-http.ts";
import { serveBridge } from "./bridge-handler.ts";
import { announcePlatform } from "./platform-record.ts";
import {
  adoptTerminals,
  closeDirectiveTerminals,
  directiveOfTerminal,
  directiveTerminal,
  setMcpUrl,
} from "@/features/terminals/index.extension.ts";
import { registerDirectiveLayout } from "@/features/directive-layout/index.extension.ts";
import { openDirectiveTerminal, runStage } from "./run-stage.ts";
import {
  directiveHolder,
  locateDirective,
  registerDirectiveButtons,
} from "@/features/directive-buttons/index.extension.ts";
import { FocusRequests, ShownTabs, focusTarget } from "@/features/object-focus/index.extension.ts";

/**
 * Сборка: порты редактора, настройки карты и один сервер на окно. Процессы плагинов внутри
 * него, поэтому сайдбар и табы одного окна видят одно и то же — решения 0013 и 0014.
 */
async function createServer(
  webview: WebviewPort,
): Promise<{ server: MapServer; mcpPort?: number }> {
  const ports = { ...createPorts(), webview };
  const state = await readMaps();
  const configs =
    state.kind === "maps" ? [...new Set(state.maps.map((map) => map.configPath))] : [];

  // Настройки рантайма лежат в том же `mapward.json` — решение 0007. Из них окну нужен только
  // порт MCP.
  const settings: Settings[] = await Promise.all(
    configs.map(async (configPath) => {
      const text = await ports.files.read(configPath);
      return text ? parseSettings(text) : {};
    }),
  );

  // Порт осторожным не бывает: сервер один, и двух портов у него нет. Разные порты в разных
  // конфигах — ошибка настройки, берётся первый (решение 0032).
  const mcpPorts = [...new Set(settings.flatMap((from) => from.mcpPort ?? []))];
  if (mcpPorts.length > 1) {
    void vscode.window.showWarningMessage(
      `mapward: в mapward.json заданы разные mcpPort (${mcpPorts.join(", ")}), беру ${String(mcpPorts[0])}`,
    );
  }

  const server = createMapServer(ports);
  return { server, ...(mcpPorts[0] === undefined ? {} : { mcpPort: mcpPorts[0] }) };
}

/** Время файла; файла нет — `undefined`, а не ноль: «не знаю» не значит «давно». */
const mtimeOf = (path: string): number | undefined => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Клиент карты для плагинов (`ctx.webview`): адрес моста известен, когда встал MCP-сервер.
  let webview: { assets: string; bridge: string } | undefined;
  // Обёртка ловит конец этапа, откуда бы он ни пришёл: сервер один и на мост, и на MCP.
  const created = await createServer(() => webview);
  const server = created.server;
  // Окно закрывается — гаснут и процессы плагинов: сироты с вотчерами никому не нужны.
  context.subscriptions.push({ dispose: () => void created.server.stopPlugins() });

  // Агент в терминале должен видеть карту так же, как человек — решение 0009. Сервер живёт,
  // пока открыта карта, и его адрес уезжает в сессии терминалов.
  const state = await readMaps();
  if (state.kind === "maps") {
    // Из какого бандла отвечает сервер — решение 0039: `__filename` здесь `dist/extension.cjs`,
    // и после `pnpm build` без перезагрузки окна он на диске новее загруженного.
    const build = bundleBuild(__filename, mtimeOf);
    // Рядом с MCP — мост клиента по http: им безголовый браузер плагина `screenshot` видит
    // карту так же, как вебвью. Табов и фокуса у такой страницы нет.
    const bridge = bridgeHttp((page) =>
      serveBridge(server, page, context.workspaceState, () => Promise.resolve()),
    );
    const mcp = await startMcpHttp(
      (transport) => serveMcp(server, state.maps, transport, build),
      created.mcpPort,
      bridge,
    );
    if (mcp.bridge) webview = { assets: join(context.extensionPath, "dist"), bridge: mcp.bridge };
    if (created.mcpPort !== undefined && !mcp.fixed) {
      void vscode.window.showWarningMessage(
        `mapward: порт MCP ${String(created.mcpPort)} занят — терминалы этого окна не переживут перезагрузку`,
      );
    }
    // Постоянный адрес — постоянные терминалы, и вернувшиеся после перезагрузки забираются
    // обратно по имени вкладки (решение 0032).
    setMcpUrl(mcp.url, mcp.fixed);
    context.subscriptions.push({ dispose: mcp.stop });
    // Одна платформа на карту: `mapward mcp` найдёт эту по файлу и станет её клиентом.
    const forget = announcePlatform(state.maps, {
      mcp: mcp.url,
      ...(mcp.bridge ? { bridge: mcp.bridge } : {}),
      host: "vscode",
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    context.subscriptions.push({ dispose: forget });
  }
  await adoptTerminals(context.workspaceState);

  // Кнопки этапов в файле директивы — решение 0032. Объект читается на каждый вопрос заново:
  // директивы и этапы меняются, пока файл открыт. Читается только тот, в чьей папке файл.
  const maps = state.kind === "maps" ? state.maps : [];
  // Кнопка «к объекту»: вкладка, которая объект показывает, или сайдбар. Список вкладок ведут
  // сами вкладки, просьбу сайдбару слушает он сам, когда поднимется.
  const tabs = new ShownTabs<vscode.WebviewPanel>();
  const focusRequests = new FocusRequests();
  const find = async (uri: vscode.Uri) => {
    for (const map of maps) {
      const address = directiveHolder(map.mapPath, uri.fsPath);
      if (address === undefined) continue;
      // oxlint-disable-next-line no-await-in-loop
      const holder = await server.readObject({ ...map, address, depth: 0 });
      const located = holder && locateDirective(holder, uri.fsPath);
      if (located) return { map, located };
    }
    return undefined;
  };
  // Директива справа сверху, её терминал под ней: пару держит раскладка, кто чей — терминалы.
  // Открыли директиву без терминала — заводится её агент; закрыли — терминал закрывается.
  context.subscriptions.push(
    registerDirectiveLayout({
      terminalOf: directiveTerminal,
      directiveOf: directiveOfTerminal,
      open: async (path) => {
        const found = await find(vscode.Uri.file(path));
        if (!found) return;
        await openDirectiveTerminal(server, {
          mapPath: found.map.mapPath,
          basePath: found.map.basePath,
          name: found.map.name,
          address: found.located.object.address,
          directive: found.located.directive,
          directivePath: path,
        });
      },
      close: (path) => closeDirectiveTerminals(path),
    }),
  );

  context.subscriptions.push(
    registerDirectiveButtons({
      locate: async (uri) => (await find(uri))?.located,
      run: async ({ uri, stage }) => {
        const found = await find(uri);
        if (!found) return;
        await runStage(server, {
          mapPath: found.map.mapPath,
          basePath: found.map.basePath,
          name: found.map.name,
          address: found.located.object.address,
          directive: found.located.directive,
          stage,
        });
      },
      focus: async ({ uri }) => {
        const found = await find(uri);
        if (!found) return;
        const wanted = { mapPath: found.map.mapPath, address: found.located.object.address };
        const target = focusTarget(tabs.list(), wanted);
        if (target.kind === "tab") {
          target.tab.reveal(target.tab.viewColumn);
          return;
        }
        focusRequests.request(wanted);
        // Команда `<вид>.focus` у редактора своя для каждого вида: открывает сайдбар и создаёт
        // вид, если его ещё не было, — тогда просьба дождётся его подписки.
        await vscode.commands.executeCommand(`${MapViewProvider.viewId}.focus`);
      },
    }),
  );

  // Мердженный конфиг метрики показывается документом без файла — решение 0019.
  context.subscriptions.push(registerVirtualDocs());

  // Табы объектов: открывает их мост, возвращает после перезапуска окна редактор — решение 0026.
  const openTab = (target: Parameters<typeof openObjectTab>[3]) =>
    openObjectTab(context, server, tabs, target);
  context.subscriptions.push(registerObjectTabs(context, server, tabs));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MapViewProvider.viewId,
      new MapViewProvider(
        context.extensionUri,
        context.workspaceState,
        server,
        openTab,
        focusRequests,
      ),
      // The map keeps where you are; rebuilding it on every sidebar switch would lose that.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}

export function deactivate(): void {}
