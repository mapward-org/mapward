import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { McpTransport } from "@mapward/abstract-server";
import { announce, livePlatform, proxyMcp, serveMcpHttp } from "./platform.ts";

/**
 * Одна платформа на карту: `mapward mcp` находит живую по `.mapward/platform.json` и ходит к ней
 * по http. Платформа здесь — подставной http-сервер, агент — транспорт в памяти.
 */

let map = "";
let platform: Server;
let url = "";
/** Что пришло платформе. */
const received: unknown[] = [];

beforeEach(async () => {
  map = (await mkdtemp(join(tmpdir(), "mapward-platform-"))).replaceAll("\\", "/");
  received.length = 0;
  platform = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const message = JSON.parse(body) as { id?: unknown; method?: string };
      received.push(message);
      if (message.id === undefined) {
        response.writeHead(204).end();
        return;
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { echo: message.method } }));
    });
  });
  await new Promise<void>((resolve) => platform.listen(0, "127.0.0.1", resolve));
  const address = platform.address();
  url = `http://127.0.0.1:${String(typeof address === "object" && address ? address.port : 0)}/mcp`;
});

afterEach(async () => {
  platform.closeAllConnections();
  await new Promise((resolve) => platform.close(resolve));
  await rm(map, { recursive: true, force: true });
});

/** Агент в памяти: шлёт сообщения и копит ответы. */
function agent() {
  let handler: ((message: unknown) => void) | undefined;
  const replies: unknown[] = [];
  const transport: McpTransport = {
    onMessage: (next) => {
      handler = next;
      return () => (handler = undefined);
    },
    send: (message) => replies.push(message),
  };
  return { transport, replies, say: (message: unknown) => handler?.(message) };
}

const until = async (done: () => boolean) => {
  for (let tick = 0; tick < 100 && !done(); tick++) {
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("живая платформа по файлу карты; нет файла, битый или молчит — платформы нет", async () => {
  expect(await livePlatform(map)).toBeUndefined();

  await mkdir(`${map}/.mapward`, { recursive: true });
  await writeFile(`${map}/.mapward/platform.json`, "не json");
  expect(await livePlatform(map)).toBeUndefined();

  const forget = announce(map, { mcp: url, host: "vscode", pid: 1, startedAt: "now" });
  expect((await livePlatform(map))?.mcp).toBe(url);
  expect(await readFile(`${map}/.mapward/.gitignore`, "utf8")).toBe("*\n");

  // Платформа ушла, а файл остался — её нет.
  platform.closeAllConnections();
  await new Promise((resolve) => platform.close(resolve));
  expect(await livePlatform(map)).toBeUndefined();
  platform.listen(0, "127.0.0.1");

  forget();
  expect(existsSync(`${map}/.mapward/platform.json`)).toBe(false);
});

test("чужую запись не снимает: файл переписала другая платформа", async () => {
  const forget = announce(map, { mcp: url, host: "cli", pid: 1, startedAt: "now" });
  announce(map, { mcp: "http://127.0.0.1:1/mcp", host: "vscode", pid: 2, startedAt: "now" });
  forget();
  expect(existsSync(`${map}/.mapward/platform.json`)).toBe(true);
});

test("прокси: вызов уходит платформе и ответ — агенту, уведомление — без ответа", async () => {
  const { transport, replies, say } = agent();
  proxyMcp(transport, url);

  say({ jsonrpc: "2.0", id: 7, method: "tools/list" });
  say({ jsonrpc: "2.0", method: "notifications/initialized" });
  await until(() => replies.length > 0 && received.length === 2);

  expect(replies).toEqual([{ jsonrpc: "2.0", id: 7, result: { echo: "tools/list" } }]);
  expect(received).toHaveLength(2);
});

test("прокси: платформа пропала — вызов получает ошибку с объяснением", async () => {
  const { transport, replies, say } = agent();
  proxyMcp(transport, "http://127.0.0.1:1/mcp");
  say({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await until(() => replies.length > 0);
  expect(JSON.stringify(replies[0])).toContain("не ответила");
});

test("свой http у mapward mcp: второй клиент через прокси получает ответ первого сервера", async () => {
  const http = await serveMcpHttp((server) =>
    server.onMessage((message) => {
      const call = message as { id?: unknown };
      server.send({ jsonrpc: "2.0", id: call.id, result: "от первого" });
    }),
  );
  try {
    const { transport, replies, say } = agent();
    proxyMcp(transport, http.url);
    say({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await until(() => replies.length > 0);
    expect(replies).toEqual([{ jsonrpc: "2.0", id: 1, result: "от первого" }]);
  } finally {
    http.stop();
  }
});
