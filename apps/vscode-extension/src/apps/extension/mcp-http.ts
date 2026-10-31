import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mcpRequests, type McpTransport } from "@mapward/abstract-server";
import type { BridgeHttp } from "./bridge-http.ts";

/**
 * MCP со стороны редактора — решение 0009: сервер поднимает расширение при открытии карты, по
 * http, в своём же процессе. Кэш и вотчеры у него общие с картой, значит писатель один и гонок
 * за файлы нет.
 *
 * Транспорт здесь request/response: агент шлёт вызов телом POST и ждёт ответ в нём же. Ответы с
 * запросами сопоставляет `mcpRequests` сервера — по своему ключу, а не по `id` клиента.
 */
export type McpHttp = {
  url: string;
  /** Мост клиента по http — у того же сервера, рядом с MCP; есть, если его дали. */
  bridge?: string;
  stop: () => void;
  /** Встал на заказанный порт: адрес переживёт перезагрузку окна (решение 0032). */
  fixed: boolean;
};

/**
 * Порт — из `mcpPort` в `mapward.json`, без него случайный. Занят заказанный (тот же проект во
 * втором окне) — сервер уходит на случайный и говорит об этом: карта из-за настройки не падает,
 * просто терминалы этого окна станут временными.
 */
export function startMcpHttp(
  serve: (transport: McpTransport) => () => void,
  port?: number,
  /** Мост клиента (`/bridge`): им рисует метрики плагин `screenshot`. */
  bridge?: BridgeHttp,
): Promise<McpHttp> {
  const mcp = mcpRequests(serve);

  const onRequest = (request: IncomingMessage, response: ServerResponse) => {
    if (bridge?.handle(request, response)) return;
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }

    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      let parsed: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(body);
        if (typeof value !== "object" || value === null) throw new TypeError("не объект");
        parsed = value as Record<string, unknown>;
      } catch {
        response.writeHead(400).end();
        return;
      }
      void mcp.request(parsed).then((answer) => {
        // Уведомление ответа не ждёт: пустой успех.
        if (answer === undefined) {
          response.writeHead(204).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer));
      });
    });
  };

  const listen = (wanted: number) =>
    new Promise<McpHttp>((resolve, reject) => {
      const http = createServer(onRequest);
      http.once("error", reject);
      // Только петля: карта чужим машинам себя не отдаёт.
      http.listen(wanted, "127.0.0.1", () => {
        const address = http.address();
        const actual = typeof address === "object" && address ? address.port : 0;
        resolve({
          url: `http://127.0.0.1:${String(actual)}/mcp`,
          ...(bridge ? { bridge: `http://127.0.0.1:${String(actual)}/bridge` } : {}),
          fixed: wanted !== 0,
          stop: () => {
            mcp.stop();
            bridge?.stop();
            // Потоки моста держат соединения открытыми: без этого `close` ждал бы их вечно.
            http.closeAllConnections();
            http.close();
          },
        });
      });
    });

  if (port === undefined) return listen(0);
  return listen(port).catch((error: unknown) => {
    console.warn(`mapward: порт MCP ${String(port)} занят, беру случайный`, error);
    return listen(0);
  });
}
