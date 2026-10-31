import type { IncomingMessage, ServerResponse } from "node:http";
import { isEnvelope } from "@mapward/core";
import type { WebviewLike } from "@/shared/bridge/transport.ts";

/**
 * Мост клиента по http — тот же, что у вебвью, только вместо `postMessage` редактора: ответы
 * платформы идут потоком событий (`GET …?session=…`, server-sent events), сообщения клиента —
 * `POST …?session=…`. Нужен тому, кто рисует клиент карты вне редактора, — плагину `screenshot`:
 * его безголовый браузер открывает ту же сборку вебвью, а платформа отвечает ей как вебвью.
 *
 * Сессия — одна страница. Поднимается на первое обращение любого из двух запросов (`POST` может
 * обогнать подписку на поток — ответы тогда ждут её в очереди) и гаснет, когда поток закрыли.
 * Сессия без потока живёт недолго: страница, которая так и не подписалась, мост не держит.
 */

/** Сколько ждать подписки на поток, прежде чем забыть сессию. */
const ORPHAN_MS = 30_000;

type Session = {
  stream?: ServerResponse;
  queue: unknown[];
  handlers: Set<(message: unknown) => void>;
  stop: () => void;
  orphan?: ReturnType<typeof setTimeout>;
};

export type BridgeHttp = {
  /** Запрос к мосту — `true`, остальное не его. */
  handle(request: IncomingMessage, response: ServerResponse): boolean;
  stop(): void;
};

export function bridgeHttp(
  serve: (webview: WebviewLike) => () => void,
  path = "/bridge",
): BridgeHttp {
  const sessions = new Map<string, Session>();

  const forget = (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.orphan);
    session.stop();
    session.stream?.end();
  };

  const open = (id: string): Session => {
    const existing = sessions.get(id);
    if (existing) return existing;
    const session: Session = { queue: [], handlers: new Set(), stop: () => {} };
    sessions.set(id, session);
    session.orphan = setTimeout(() => forget(id), ORPHAN_MS);
    const webview: WebviewLike = {
      postMessage: (message) => {
        if (session.stream) session.stream.write(`data: ${JSON.stringify(message)}\n\n`);
        else session.queue.push(message);
        return true;
      },
      onDidReceiveMessage: (handler) => {
        session.handlers.add(handler);
        return { dispose: () => session.handlers.delete(handler) };
      },
    };
    session.stop = serve(webview);
    return session;
  };

  const subscribe = (id: string, response: ServerResponse) => {
    const session = open(id);
    clearTimeout(session.orphan);
    session.stream?.end();
    session.stream = response;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for (const message of session.queue.splice(0)) {
      response.write(`data: ${JSON.stringify(message)}\n\n`);
    }
    response.on("close", () => {
      if (sessions.get(id)?.stream === response) forget(id);
    });
  };

  const receive = (id: string, request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      let message: unknown;
      try {
        message = JSON.parse(body);
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (!isEnvelope(message)) {
        response.writeHead(400).end();
        return;
      }
      for (const handler of open(id).handlers) handler(message);
      response.writeHead(204).end();
    });
  };

  return {
    handle(request, response) {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== path) return false;
      const id = url.searchParams.get("session");
      if (!id) {
        response.writeHead(400).end();
        return true;
      }
      if (request.method === "GET") subscribe(id, response);
      else if (request.method === "POST") receive(id, request, response);
      else response.writeHead(405).end();
      return true;
    },
    stop() {
      // Удалять из `Map` по ходу её обхода можно: удалённое обход просто не встретит.
      for (const id of sessions.keys()) forget(id);
    },
  };
}
