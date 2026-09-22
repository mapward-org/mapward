import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpTransport } from "@mapward/abstract-server";

/**
 * MCP со стороны редактора — решение 0009: сервер поднимает расширение при открытии карты, по
 * http, в своём же процессе. Кэш и вотчеры у него общие с картой, значит писатель один и гонок
 * за файлы нет.
 *
 * Транспорт здесь request/response: агент шлёт вызов телом POST и ждёт ответ в нём же, поэтому
 * ответы сопоставляются с запросами по `id`.
 *
 * Сопоставляются по своему ключу, а не по клиентскому `id`. У http каждый вызов — отдельное
 * соединение, и клиент вправе нумеровать их с единицы: два одновременных вызова с `id: 1`
 * затёрли бы друг друга, первый повис бы, а его ответ уехал бы во второй. Ответ при этом
 * правильный по форме и про чужой объект — заметить это можно только по полю `address`.
 * Поэтому наружу возвращается тот `id`, который прислал клиент.
 */
export type McpHttp = {
  url: string;
  stop: () => void;
  /** Встал на заказанный порт: адрес переживёт перезагрузку окна (решение 0032). */
  fixed: boolean;
};

type Pending = (message: unknown) => void;

/**
 * Порт — из `mcpPort` в `mapward.json`, без него случайный. Занят заказанный (тот же проект во
 * втором окне) — сервер уходит на случайный и говорит об этом: карта из-за настройки не падает,
 * просто терминалы этого окна станут временными.
 */
export function startMcpHttp(
  serve: (transport: McpTransport) => () => void,
  port?: number,
): Promise<McpHttp> {
  const waiting = new Map<string, Pending>();
  let handler: ((message: unknown) => void) | undefined;
  let last = 0;

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
      let parsed: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(body);
        if (typeof value !== "object" || value === null) throw new TypeError("не объект");
        parsed = value as Record<string, unknown>;
      } catch {
        response.writeHead(400).end();
        return;
      }

      // Уведомление ответа не ждёт: отдаём пустой успех и уходим.
      if (parsed.id === undefined || parsed.id === null) {
        handler?.(parsed);
        response.writeHead(204).end();
        return;
      }

      const theirs = parsed.id;
      last += 1;
      const key = `http-${String(last)}`;

      waiting.set(key, (message) => {
        response.writeHead(200, { "content-type": "application/json" });
        // Клиент ждёт свой номер: ключ наш, и наружу он не уезжает.
        const answer =
          typeof message === "object" && message !== null
            ? { ...(message as Record<string, unknown>), id: theirs }
            : message;
        response.end(JSON.stringify(answer));
      });
      handler?.({ ...parsed, id: key });
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
          fixed: wanted !== 0,
          stop: () => {
            stopServe();
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
