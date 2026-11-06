import { runPlugin } from "@mapward/plugin";
import type { PlatformMessage, PluginDefinition, PluginMessage } from "@mapward/plugin";

/**
 * Плагин в том же рантайме, что в процессе, против поддельного канала: платформа здесь — тест.
 * Лежит рядом с плагинами, а не в них: в карту копируются только их папки.
 */

/** Строка лога, которую плагин написал через `ctx`: вид и текст. */
export type LogEntry = { kind: string; text: string };

export type Outcome = { values: unknown[]; error?: string; logs: LogEntry[] };

/**
 * Плагин в рантайме и вызов его метода. Просьбы к другим плагинам (`ctx.plugin`) тест отдаёт
 * плагину из `peers` — так `shell.steps` доходит до `agent`. Строки лога соседей ложатся в тот же
 * список: у платформы они были бы в том же трейсе.
 */
export function plugin(
  dir: string,
  definition: PluginDefinition,
  peers: Record<string, PluginDefinition> = {},
  logs: LogEntry[] = [],
) {
  let handler: ((message: PlatformMessage) => void) | undefined;
  /** Кто ждёт строки лога: вызов, которому их показывают по мере прихода. */
  const watching = new Set<(entry: LogEntry) => void>();
  const say = (message: PlatformMessage) => handler?.(message);
  const listeners = new Map<string, (message: PluginMessage) => void>();
  /** Идущие просьбы к соседям: отпустил поток — сосед снимает свой. */
  const peerCalls = new Map<string, () => void>();
  const logged = (entry: LogEntry) => {
    logs.push(entry);
    for (const watcher of watching) watcher(entry);
  };
  runPlugin(definition, {
    send: (message) => {
      if (message.t === "log") {
        logged({ kind: message.kind, text: message.text });
        return;
      }
      if (message.t === "request" && message.op === "plugin") {
        const name = message.path.split("/").pop() ?? "";
        const peer = peers[name];
        if (!peer) {
          queueMicrotask(() => say({ t: "rerror", id: message.id, message: `нет ${name}` }));
          return;
        }
        const { cancel } = plugin(dir, peer, {}, logs).stream(message.method, message.args, {
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
      log?: (entry: LogEntry) => void;
    },
  ) => {
    const id = `c${++counter}`;
    const { log } = observer;
    if (log) watching.add(log);
    const done = () => {
      if (log) watching.delete(log);
    };
    listeners.set(id, (message) => {
      if (message.t === "next") observer.next(message.value);
      else if (message.t === "error") {
        done();
        observer.error(message.message);
      } else if (message.t === "complete") {
        done();
        observer.complete();
      }
    });
    say({ t: "call", id, method, args, trace: `t-${id}` });
    return {
      cancel: () => {
        done();
        say({ t: "cancel", id });
      },
    };
  };
  /** Весь поток до конца или ошибки — и строки лога, написанные за это время. */
  const call = (method: string, args: unknown) =>
    new Promise<Outcome>((resolve) => {
      const values: unknown[] = [];
      const from = logs.length;
      stream(method, args, {
        next: (value) => values.push(value),
        error: (error) => resolve({ values, error, logs: logs.slice(from) }),
        complete: () => resolve({ values, logs: logs.slice(from) }),
      });
    });
  return { call, stream };
}
