import { expect, test } from "vitest";
import type { McpTransport } from "@mapward/abstract-server";
import type { WebviewLike } from "@/shared/bridge/transport.ts";
import { bridgeHttp } from "./bridge-http.ts";
import { startMcpHttp } from "./mcp-http.ts";

/**
 * Мост клиента по http рядом с MCP: страница безголового браузера шлёт конверты `POST`, а ответы
 * получает потоком событий. Платформа здесь — эхо: на каждое сообщение отвечает им же.
 */

const envelope = (id: string) => ({ kind: "call", id, method: "ping" });

test("сообщение страницы доходит до платформы, ответ — потоком; ответ до подписки ждёт её", async () => {
  const opened: string[] = [];
  let stopped = 0;
  const bridge = bridgeHttp((page: WebviewLike) => {
    opened.push("сессия");
    const subscription = page.onDidReceiveMessage(
      // Это вебвью-подобный канал, а не окно: `targetOrigin` у него нет.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      (message) => void page.postMessage(message),
    );
    return () => {
      stopped += 1;
      subscription.dispose();
    };
  });
  const mcp = await startMcpHttp((_transport: McpTransport) => () => {}, undefined, bridge);
  try {
    expect(mcp.bridge).toMatch(/\/bridge$/);
    const url = `${mcp.bridge ?? ""}?session=a`;

    // Сообщение обгоняет подписку: ответ копится и приходит первым кадром потока.
    const posted = await fetch(url, { method: "POST", body: JSON.stringify(envelope("1")) });
    expect(posted.status).toBe(204);

    const controller = new AbortController();
    const stream = await fetch(url, { signal: controller.signal });
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const reader = stream.body?.getReader();
    const first = new TextDecoder().decode((await reader?.read())?.value);
    expect(first).toContain('"id":"1"');

    await fetch(url, { method: "POST", body: JSON.stringify(envelope("2")) });
    const second = new TextDecoder().decode((await reader?.read())?.value);
    expect(second).toContain('"id":"2"');

    // Не конверт — мимо платформы.
    expect((await fetch(url, { method: "POST", body: '{"x":1}' })).status).toBe(400);
    expect(opened).toEqual(["сессия"]);

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stopped).toBe(1);
  } finally {
    mcp.stop();
  }
});
