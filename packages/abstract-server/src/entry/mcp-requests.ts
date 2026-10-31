import type { McpTransport } from "./mcp.ts";

/**
 * MCP вида «запрос — ответ» поверх потокового транспорта: так его отдаёт http, где каждый вызов —
 * отдельное соединение и ответ ждут в нём же. Сервера http здесь нет — он у приложения; здесь
 * только сопоставление ответов с запросами.
 *
 * Сопоставляются по своему ключу, а не по клиентскому `id`. У http каждый вызов — отдельное
 * соединение, и клиент вправе нумеровать их с единицы: два одновременных вызова с `id: 1`
 * затёрли бы друг друга, первый повис бы, а его ответ уехал бы во второй. Ответ при этом
 * правильный по форме и про чужой объект — заметить это можно только по полю `address`.
 * Поэтому наружу возвращается тот `id`, который прислал клиент.
 */
export type McpRequests = {
  /** Ответ на вызов; у уведомления (без `id`) ответа нет — `undefined` сразу. */
  request(message: Record<string, unknown>): Promise<unknown>;
  stop(): void;
};

export function mcpRequests(serve: (transport: McpTransport) => () => void): McpRequests {
  const waiting = new Map<string, (message: unknown) => void>();
  let handler: ((message: unknown) => void) | undefined;
  let last = 0;

  const stop = serve({
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
  });

  return {
    request(message) {
      // Уведомление ответа не ждёт.
      if (message.id === undefined || message.id === null) {
        handler?.(message);
        return Promise.resolve(undefined);
      }
      const theirs = message.id;
      last += 1;
      const key = `http-${String(last)}`;
      return new Promise((resolve) => {
        waiting.set(key, (answer) =>
          // Клиент ждёт свой номер: ключ наш, и наружу он не уезжает.
          resolve(
            typeof answer === "object" && answer !== null
              ? { ...(answer as Record<string, unknown>), id: theirs }
              : answer,
          ),
        );
        handler?.({ ...message, id: key });
      });
    },
    stop,
  };
}
