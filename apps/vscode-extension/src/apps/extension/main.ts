import * as vscode from "vscode";
import { createMapServer, parseSettings, serveMcp } from "@mapward/abstract-server";
import type { MapServer, ServerSettings } from "@mapward/abstract-server";
import { readMaps, registerVirtualDocs } from "@/features/maps/index.extension.ts";
import { createPorts } from "./ports/index.ts";
import { MapViewProvider } from "./map-view.ts";
import { openObjectTab, registerObjectTabs } from "./object-tab.ts";
import { startMcpHttp } from "./mcp-http.ts";
import { setMcpUrl } from "@/features/terminals/index.extension.ts";
import { withStageTabs } from "./stage-tabs.ts";

/**
 * Сборка: порты редактора, настройки карты и один сервер на окно. Стор метрик внутри него,
 * поэтому сайдбар и табы одного окна видят одно и то же — решения 0013 и 0014.
 */
async function createServer(): Promise<MapServer> {
  const ports = createPorts();
  const state = await readMaps();
  const configs =
    state.kind === "maps" ? [...new Set(state.maps.map((map) => map.configPath))] : [];

  // Настройки рантайма лежат в том же `mapward.json` — решения 0007, 0013 и 0016. Сервер в окне
  // один, а конфигов бывает несколько: по каждой настройке берём самую осторожную, иначе одна
  // карта сняла бы ограничение, поставленное другой. Для свежести осторожнее меньшее — реже
  // показываем старое.
  const settings = await Promise.all(
    configs.map(async (configPath) => {
      const text = await ports.files.read(configPath);
      return text ? parseSettings(text) : {};
    }),
  );

  const strictest = (pick: (from: ServerSettings) => number | undefined) => {
    const values = settings
      .map(pick)
      .filter((value): value is number => typeof value === "number" && value > 0);
    return values.length > 0 ? Math.min(...values) : undefined;
  };

  const concurrency = strictest((from) => from.metricsConcurrency);
  const collectors = strictest((from) => from.collectorsStaleTime);
  const transforms = strictest((from) => from.transformsStaleTime);

  return createMapServer(ports, {
    ...(concurrency === undefined ? {} : { metricsConcurrency: concurrency }),
    ...(collectors === undefined ? {} : { collectorsStaleTime: collectors }),
    ...(transforms === undefined ? {} : { transformsStaleTime: transforms }),
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Обёртка ловит конец этапа, откуда бы он ни пришёл: сервер один и на мост, и на MCP.
  const server = withStageTabs(await createServer());

  // Агент в терминале должен видеть карту так же, как человек — решение 0009. Сервер живёт,
  // пока открыта карта, и его адрес уезжает в сессии терминалов.
  const state = await readMaps();
  if (state.kind === "maps") {
    const mcp = await startMcpHttp((transport) => serveMcp(server, state.maps, transport));
    setMcpUrl(mcp.url);
    context.subscriptions.push({ dispose: mcp.stop });
  }

  // Мердженный конфиг метрики показывается документом без файла — решение 0019.
  context.subscriptions.push(registerVirtualDocs());

  // Табы объектов: открывает их мост, возвращает после перезапуска окна редактор — решение 0026.
  const openTab = (target: Parameters<typeof openObjectTab>[2]) =>
    openObjectTab(context, server, target);
  context.subscriptions.push(registerObjectTabs(context, server));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MapViewProvider.viewId,
      new MapViewProvider(context.extensionUri, context.workspaceState, server, openTab),
      // The map keeps where you are; rebuilding it on every sidebar switch would lose that.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}

export function deactivate(): void {}
