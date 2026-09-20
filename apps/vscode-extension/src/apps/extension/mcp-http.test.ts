import { expect, test } from "vitest";
import type { McpTransport } from "@mapward/abstract-server";
import { startMcpHttp } from "./mcp-http.ts";

/**
 * Транспорт редактора — http, и каждый вызов у него отдельное соединение. Клиент вправе
 * нумеровать вызовы с единицы, поэтому свой `id` в ответах ключом быть не может.
 */
const post = async (url: string, body: unknown): Promise<Record<string, unknown>> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
};

test("two calls with the same id do not take each other's answer", async () => {
  // Сервер отвечает не сразу и вразнобой: первый вызов ждёт дольше второго.
  const delays: Record<string, number> = { first: 20, second: 0 };
  const serve = (transport: McpTransport) =>
    transport.onMessage((message) => {
      const call = message as { id?: unknown; params?: { name?: string } };
      const name = call.params?.name ?? "";
      setTimeout(() => {
        transport.send({ jsonrpc: "2.0", id: call.id, result: { name } });
      }, delays[name] ?? 0);
    });

  const http = await startMcpHttp(serve);
  try {
    const [first, second] = await Promise.all([
      post(http.url, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "first" } }),
      post(http.url, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "second" } }),
    ]);

    // Каждый получил свой ответ, а не ответ соседа — и со своим номером.
    expect(first).toEqual({ jsonrpc: "2.0", id: 1, result: { name: "first" } });
    expect(second).toEqual({ jsonrpc: "2.0", id: 1, result: { name: "second" } });
  } finally {
    http.stop();
  }
});

test("a notification is answered with an empty success and no waiting", async () => {
  const seen: unknown[] = [];
  const http = await startMcpHttp((transport) =>
    transport.onMessage((message) => {
      seen.push(message);
    }),
  );

  try {
    const response = await fetch(http.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(response.status).toBe(204);
    expect(seen).toHaveLength(1);
  } finally {
    http.stop();
  }
});
