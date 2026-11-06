import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  formatPlatform,
  localDir,
  mcpRequests,
  parsePlatform,
  platformFile,
  withTrace,
  type McpTransport,
  type PlatformRecord,
} from "@mapward/abstract-server";
import { TRACE_HEADER } from "@mapward/core";

/**
 * Одна платформа на карту. `mapward mcp` сначала смотрит в `<карта>/.mapward/platform.json`:
 * платформа там жива — команда становится её тонким клиентом и своих процессов плагинов не
 * поднимает; нет — поднимается сама и тоже пишет файл, чтобы следующий `mapward mcp` пришёл к
 * ней.
 */

/** Сколько ждать ответа живой платформы на пробу: дольше — считаем, что её нет. */
const ALIVE_MS = 1500;

/** Запись из файла карты, если платформа по ней отвечает. */
export async function livePlatform(mapPath: string): Promise<PlatformRecord | undefined> {
  let record: PlatformRecord | undefined;
  try {
    record = parsePlatform(readFileSync(platformFile(mapPath), "utf8"));
  } catch {
    return undefined;
  }
  if (!record) return undefined;
  try {
    // Любой ответ — платформа жива: неизвестный метод тоже отвечает, ошибкой.
    const response = await fetch(record.mcp, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "mapward-alive", method: "ping" }),
      signal: AbortSignal.timeout(ALIVE_MS),
    });
    return response.ok || response.status === 204 ? record : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Тонкий клиент: каждое сообщение агента — `POST` живой платформе, её ответ — агенту. Платформа
 * перестала отвечать — вызов получает ошибку с объяснением, уведомление теряется.
 */
export function proxyMcp(transport: McpTransport, url: string): () => void {
  return transport.onMessage((message) => {
    const id = (message as { id?: unknown }).id;
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    })
      .then(async (response) => {
        if (response.status === 204) return;
        if (!response.ok) throw new Error(`код ${String(response.status)}`);
        transport.send(await response.json());
      })
      .catch((error: unknown) => {
        if (id === undefined || id === null) return;
        transport.send({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: `живая платформа ${url} не ответила: ${error instanceof Error ? error.message : String(error)}. Перезапустите mapward mcp — он поднимет свою`,
          },
        });
      });
  });
}

/** MCP по http на случайном порту петли — адрес для `platform.json`. */
export function serveMcpHttp(
  serve: (transport: McpTransport) => () => void,
): Promise<{ url: string; stop: () => void }> {
  const mcp = mcpRequests(serve);
  const http = createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (typeof parsed !== "object" || parsed === null) {
        response.writeHead(400).end();
        return;
      }
      const message = withTrace(parsed as Record<string, unknown>, request.headers[TRACE_HEADER]);
      void mcp.request(message).then((answer) => {
        if (answer === undefined) response.writeHead(204).end();
        else
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(answer));
      });
    });
  });
  return new Promise((resolve, reject) => {
    http.once("error", reject);
    // Только петля: карта чужим машинам себя не отдаёт.
    http.listen(0, "127.0.0.1", () => {
      const address = http.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${String(port)}/mcp`,
        stop: () => {
          mcp.stop();
          http.closeAllConnections();
          http.close();
        },
      });
    });
  });
}

/**
 * Записать себя платформой карты; ответ — снять запись. Снимается только своя: файл, который
 * успела переписать другая платформа, не трогается.
 */
export function announce(mapPath: string, record: PlatformRecord): () => void {
  const file = platformFile(mapPath);
  mkdirSync(localDir(mapPath), { recursive: true });
  const ignore = `${localDir(mapPath)}/.gitignore`;
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  writeFileSync(file, formatPlatform(record));
  return () => {
    try {
      if (parsePlatform(readFileSync(file, "utf8"))?.mcp === record.mcp) rmSync(file);
    } catch {
      // Файла уже нет.
    }
  };
}
