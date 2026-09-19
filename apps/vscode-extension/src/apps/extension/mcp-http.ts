import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpTransport } from "@mapward/abstract-server";

/**
 * MCP со стороны редактора — решение 0009: сервер поднимает расширение при открытии карты, по
 * http, в своём же процессе. Кэш и вотчеры у него общие с картой, значит писатель один и гонок
 * за файлы нет.
 *
 * Транспорт здесь request/response: агент шлёт вызов телом POST и ждёт ответ в нём же, поэтому
 * ответы сопоставляются с запросами по `id`.
 */
export type McpHttp = { url: string; stop: () => void };

type Pending = (message: unknown) => void;

export function startMcpHttp(serve: (transport: McpTransport) => () => void): Promise<McpHttp> {
  const waiting = new Map<string, Pending>();
  let handler: ((message: unknown) => void) | undefined;

  const transport: McpTransport = {
    onMessage(next) {
      handler = next;
      return () => (handler = undefined);
    },
    send(message) {
      const id = String((message as { id?: unknown }).id ?? "");
      const pending = waiting.get(id);
      if (!pending) return;
      waiting.delete(id);
      pending(message);
    },
  };

  const stopServe = serve(transport);

  const onRequest = (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }

    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      let parsed: { id?: unknown };
      try {
        parsed = JSON.parse(body) as { id?: unknown };
      } catch {
        response.writeHead(400).end();
        return;
      }

      const id = String(parsed.id ?? "");
      // Уведомление ответа не ждёт: отдаём пустой успех и уходим.
      if (!id) {
        handler?.(parsed);
        response.writeHead(204).end();
        return;
      }

      waiting.set(id, (message) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(message));
      });
      handler?.(parsed);
    });
  };

  return new Promise((resolve) => {
    const http = createServer(onRequest);
    // Только петля: карта чужим машинам себя не отдаёт.
    http.listen(0, "127.0.0.1", () => {
      const address = http.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${String(port)}/mcp`,
        stop: () => {
          stopServe();
          http.close();
        },
      });
    });
  });
}
