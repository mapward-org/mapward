import { runPlugin } from "@mapward/plugin";
import type { PlatformMessage, PluginDefinition, PluginMessage } from "@mapward/plugin";

/**
 * Плагин в том же рантайме, что в процессе, против поддельного канала: платформа здесь — тест.
 * Лежит рядом с плагинами, а не в них: в карту копируются только их папки.
 */

export type Outcome = { values: unknown[]; error?: string };

/**
 * Плагин в рантайме и вызов его метода. Просьбы к другим плагинам (`ctx.plugin`) тест отдаёт
 * плагину из `peers` — так `shell.steps` доходит до `agent`.
 */
export function plugin(
  dir: string,
  definition: PluginDefinition,
  peers: Record<string, PluginDefinition> = {},
) {
  let handler: ((message: PlatformMessage) => void) | undefined;
  const say = (message: PlatformMessage) => handler?.(message);
  const listeners = new Map<string, (message: PluginMessage) => void>();
  /** Идущие просьбы к соседям: отпустил поток — сосед снимает свой. */
  const peerCalls = new Map<string, () => void>();
  runPlugin(definition, {
    send: (message) => {
      if (message.t === "request" && message.op === "plugin") {
        const name = message.path.split("/").pop() ?? "";
        const peer = peers[name];
        if (!peer) {
          queueMicrotask(() => say({ t: "rerror", id: message.id, message: `нет ${name}` }));
          return;
        }
        const { cancel } = plugin(dir, peer).stream(message.method, message.args, {
          next: (value) => say({ t: "rnext", id: message.id, value }),
          error: (text) => say({ t: "rerror", id: message.id, message: text }),
          complete: () => say({ t: "rcomplete", id: message.id }),
        });
        peerCalls.set(message.id, cancel);
        return;
      }
      if (message.t === "release") {
        peerCalls.get(message.id)?.();
        peerCalls.delete(message.id);
        return;
      }
      if ("id" in message) listeners.get(message.id)?.(message);
    },
    onMessage: (next) => {
      handler = next;
    },
    log: () => {},
    exit: () => {},
  });
  say({
    t: "hello",
    map: { name: "m", mapPath: dir, basePath: dir },
    pluginDir: `${dir}/_plugins/x`,
    isVscode: false,
  });

  let counter = 0;
  const stream = (
    method: string,
    args: unknown,
    observer: {
      next: (value: unknown) => void;
      error: (text: string) => void;
      complete: () => void;
    },
  ) => {
    const id = `c${++counter}`;
    listeners.set(id, (message) => {
      if (message.t === "next") observer.next(message.value);
      else if (message.t === "error") observer.error(message.message);
      else if (message.t === "complete") observer.complete();
    });
    say({ t: "call", id, method, args });
    return { cancel: () => say({ t: "cancel", id }) };
  };
  /** Весь поток до конца или ошибки. */
  const call = (method: string, args: unknown) =>
    new Promise<Outcome>((resolve) => {
      const values: unknown[] = [];
      stream(method, args, {
        next: (value) => values.push(value),
        error: (error) => resolve({ values, error }),
        complete: () => resolve({ values }),
      });
    });
  return { call, stream };
}
