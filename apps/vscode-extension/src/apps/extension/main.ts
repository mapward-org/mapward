import * as vscode from "vscode";
import { createMapServer, parseSettings, serveMcp } from "@mapward/abstract-server";
import type { MapServer, ServerSettings } from "@mapward/abstract-server";
import { readMaps, registerVirtualDocs } from "@/features/maps/index.extension.ts";
import { createPorts } from "./ports/index.ts";
import { MapViewProvider } from "./map-view.ts";
import { openObjectTab, registerObjectTabs } from "./object-tab.ts";
import { startMcpHttp } from "./mcp-http.ts";
import { adoptTerminals, setMcpUrl } from "@/features/terminals/index.extension.ts";
import { withStageTabs } from "./stage-tabs.ts";
import { runStage } from "./run-stage.ts";
import {
  locateDirective,
  registerDirectiveButtons,
} from "@/features/directive-buttons/index.extension.ts";

/**
 * Сборка: порты редактора, настройки карты и один сервер на окно. Стор метрик внутри него,
 * поэтому сайдбар и табы одного окна видят одно и то же — решения 0013 и 0014.
 */
async function createServer(): Promise<{ server: MapServer; mcpPort?: number }> {
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

  // Порт осторожным не бывает: сервер один, и двух портов у него нет. Разные порты в разных
  // конфигах — ошибка настройки, берётся первый (решение 0032).
  const mcpPorts = [...new Set(settings.flatMap((from) => from.mcpPort ?? []))];
  if (mcpPorts.length > 1) {
    void vscode.window.showWarningMessage(
      `mapward: в mapward.json заданы разные mcpPort (${mcpPorts.join(", ")}), беру ${String(mcpPorts[0])}`,
    );
  }

  const server = createMapServer(ports, {
    ...(concurrency === undefined ? {} : { metricsConcurrency: concurrency }),
    ...(collectors === undefined ? {} : { collectorsStaleTime: collectors }),
    ...(transforms === undefined ? {} : { transformsStaleTime: transforms }),
  });
  return { server, ...(mcpPorts[0] === undefined ? {} : { mcpPort: mcpPorts[0] }) };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Обёртка ловит конец этапа, откуда бы он ни пришёл: сервер один и на мост, и на MCP.
  const created = await createServer();
  const server = withStageTabs(created.server);

  // Агент в терминале должен видеть карту так же, как человек — решение 0009. Сервер живёт,
  // пока открыта карта, и его адрес уезжает в сессии терминалов.
  const state = await readMaps();
  if (state.kind === "maps") {
    const mcp = await startMcpHttp(
      (transport) => serveMcp(server, state.maps, transport),
      created.mcpPort,
    );
    if (created.mcpPort !== undefined && !mcp.fixed) {
      void vscode.window.showWarningMessage(
        `mapward: порт MCP ${String(created.mcpPort)} занят — терминалы этого окна не переживут перезагрузку`,
      );
    }
    // Постоянный адрес — постоянные терминалы, и вернувшиеся после перезагрузки забираются
    // обратно по имени вкладки (решение 0032).
    setMcpUrl(mcp.url, mcp.fixed);
    context.subscriptions.push({ dispose: mcp.stop });
  }
  await adoptTerminals(context.workspaceState);

  // Кнопки этапов в файле директивы — решение 0032. Карта читается на каждый вопрос заново:
  // сервер держит её в кэше, а директивы и этапы меняются, пока файл открыт.
  const maps = state.kind === "maps" ? state.maps : [];
  const find = async (uri: vscode.Uri) => {
    for (const map of maps) {
      // oxlint-disable-next-line no-await-in-loop
      const located = locateDirective(await server.getMap(map), uri.fsPath);
      if (located) return { map, located };
    }
    return undefined;
  };
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
    }),
  );

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
