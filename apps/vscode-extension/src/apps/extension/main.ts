import * as vscode from "vscode";
import { createMapServer, parseSettings, serveMcp } from "@mapward/abstract-server";
import type { MapServer } from "@mapward/abstract-server";
import { readMaps } from "@/features/maps/index.extension.ts";
import { createPorts } from "./ports/index.ts";
import { MapViewProvider } from "./map-view.ts";
import { startMcpHttp } from "./mcp-http.ts";
import { setMcpUrl } from "@/features/terminals/index.extension.ts";

/**
 * Сборка: порты редактора, настройки карты и один сервер на окно. Стор метрик внутри него,
 * поэтому сайдбар и табы одного окна видят одно и то же — решения 0013 и 0014.
 */
async function createServer(): Promise<MapServer> {
  const ports = createPorts();
  const state = await readMaps();
  const configs =
    state.kind === "maps" ? [...new Set(state.maps.map((map) => map.configPath))] : [];

  // Настройки рантайма лежат в том же `mapward.json` — решения 0007 и 0013. Сервер в окне один,
  // а конфигов бывает несколько: берём самый осторожный лимит, иначе одна карта сняла бы
  // ограничение, поставленное другой.
  const limits = (
    await Promise.all(
      configs.map(async (configPath) => {
        const text = await ports.files.read(configPath);
        return text ? parseSettings(text).metricsConcurrency : undefined;
      }),
    )
  ).filter((limit): limit is number => typeof limit === "number" && limit > 0);

  return createMapServer(
    ports,
    limits.length > 0 ? { metricsConcurrency: Math.min(...limits) } : {},
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const server = await createServer();

  // Агент в терминале должен видеть карту так же, как человек — решение 0009. Сервер живёт,
  // пока открыта карта, и его адрес уезжает в сессии терминалов.
  const state = await readMaps();
  if (state.kind === "maps") {
    const mcp = await startMcpHttp((transport) => serveMcp(server, state.maps, transport));
    setMcpUrl(mcp.url);
    context.subscriptions.push({ dispose: mcp.stop });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MapViewProvider.viewId,
      new MapViewProvider(context.extensionUri, context.workspaceState, server),
      // The map keeps where you are; rebuilding it on every sidebar switch would lose that.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}

export function deactivate(): void {}
