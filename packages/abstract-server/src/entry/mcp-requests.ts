import { TRACE_META } from "@mapward/core";
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

/**
 * Трейс из заголовка `x-mapward-trace` — в `_meta` вызова инструмента: агент, которого запустил
 * экшон, ходит в MCP с этим заголовком, и всё, что он делает через карту, ложится в трейс экшона.
 * Заголовка нет или это не вызов инструмента — сообщение как есть.
 */
export function withTrace(
  message: Record<string, unknown>,
  header: string | string[] | undefined,
): Record<string, unknown> {
  const trace = Array.isArray(header) ? header[0] : header;
  if (!trace || message.method !== "tools/call") return message;
  const params = (
    typeof message.params === "object" && message.params !== null ? message.params : {}
  ) as Record<string, unknown>;
  const found = params[MCP_META];
  const meta = (typeof found === "object" && found !== null ? found : {}) as Record<
    string,
    unknown
  >;
  return { ...message, params: { ...params, [MCP_META]: { ...meta, [TRACE_META]: trace } } };
}

/** Поле служебных данных вызова в протоколе MCP — имя задано протоколом. */
export const MCP_META = "_meta";
