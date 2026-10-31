/**
 * Рантайм плагина — то, что едет в каждую сборку плагина и говорит с платформой.
 *
 * Платформа кладёт в сборку плагина собранный пакет одним файлом (`dist/index.mjs`, со всеми
 * зависимостями внутри) как модуль `@mapward/plugin`: у установленного расширения
 * `node_modules` нет, а копия из проекта могла бы разойтись с протоколом платформы.
 */

import { firstValueFrom, Observable, type Subscriber, type Unsubscribable } from "rxjs";
import type {
  AnyMethod,
  MapEditOp,
  MapEditResult,
  MapObject,
  PlatformMessage,
  PluginClient,
  PluginCtx,
  PluginDefinition,
  PluginDescription,
  PluginMap,
  PluginMessage,
  PluginObject,
  PluginRequest,
  PluginVscode,
  PluginWebview,
  WithParams,
  WithResult,
} from "./types.ts";
import { schemaErrors } from "./schema.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Тождество ради типов: `args` метода выводятся из его `params`, значения потока сверяются с
 * `result` (схема typebox или буквальная JSON-схема), а `usePlugin<typeof plugin>` потом берёт
 * типы отсюда. Схемы нет — тип из подписи `run`, как раньше.
 */
export function definePlugin<
  // Без `run` в ограничении: иначе его `any` стал бы контекстом стрелки, и вывод из схем пропал.
  Definition extends Omit<PluginDefinition, "methods"> & {
    methods: Record<string, Omit<AnyMethod, "run"> & { run: unknown }>;
  },
  const Params extends Record<string, unknown>,
  const Results extends Record<string, unknown>,
>(
  definition: Definition & {
    methods: { [K in keyof Params]: WithParams<Params[K]> } & {
      [K in keyof Results]: WithResult<Results[K]>;
    };
  },
): Definition {
  return definition;
}

const SCHEME = "mapward://";
const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);
const slash = (path: string) => path.replaceAll("\\", "/");

function joinPath(base: string, rest: string): string {
  const parts: string[] = [];
  for (const part of `${slash(base)}/${rest}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && (part !== "" || parts.length === 0)) parts.push(part);
  }
  const joined = parts.join("/");
  return joined.endsWith("/") && joined.length > 1 ? joined.slice(0, -1) : joined;
}

/**
 * Путь из адреса — чистая функция: адрес без решётки это путь, и спрашивать платформу ради него
 * незачем. `@` — корень проекта, `~` — объект `from`. Не адрес — путь от карты.
 */
export function resolveAddress(address: string, map: PluginMap, from?: string): string {
  if (!address.startsWith(SCHEME)) {
    return isAbsolute(slash(address)) ? slash(address) : joinPath(map.mapPath, address);
  }
  const body = address.slice(SCHEME.length);
  if (body.includes("#")) {
    throw new Error(`${address} — значение, а не путь: его даёт ctx.object`);
  }
  const [head = "", ...rest] = body.split("/");
  const tail = rest.join("/");
  if (head === "@") return tail ? joinPath(map.basePath, tail) : slash(map.basePath);
  if (head === "~") {
    if (!from) throw new Error(`${address}: «~» без объекта — передайте адрес вторым аргументом`);
    const base = resolveAddress(from, map);
    return tail ? joinPath(base, tail) : base;
  }
  return body ? joinPath(map.mapPath, body) : slash(map.mapPath);
}

/** Первое значение просьбы — промисом: так зовётся редактор. Пустой ответ — `undefined`. */
const first = <T>(stream: Observable<T>): Promise<T> =>
  firstValueFrom(stream, { defaultValue: undefined as T });

/** Канал до платформы: строки протокола в обе стороны. */
export type PluginIo = {
  send(message: PluginMessage): void;
  onMessage(handler: (message: PlatformMessage) => void): void;
  log(text: string): void;
  exit(code: number): void;
};

/**
 * Плагин против канала: рукопожатие, вызовы, просьбы к платформе, остановка. С платформой и с
 * поддельным каналом в тестах работает одинаково.
 */
export function runPlugin(definition: PluginDefinition, io: PluginIo): void {
  const calls = new Map<string, Unsubscribable>();
  const requests = new Map<string, Subscriber<unknown>>();
  let ctx: PluginCtx | undefined;
  let counter = 0;
  let stopping = false;

  const request = <T>(body: PluginRequest): Observable<T> =>
    new Observable<T>((subscriber) => {
      const id = `r${++counter}`;
      requests.set(id, subscriber as Subscriber<unknown>);
      io.send({ t: "request", id, ...body });
      return () => {
        if (!requests.delete(id)) return;
        io.send({ t: "release", id });
      };
    });

  const vscode: PluginVscode = {
    openFile: (path, options) =>
      first(request({ op: "vscode", method: "openFile", args: [path, options ?? {}] })),
    reveal: (path) => first(request({ op: "vscode", method: "reveal", args: [path] })),
    showMessage: (text, level) =>
      first(request({ op: "vscode", method: "showMessage", args: [text, level ?? "info"] })),
    terminal: (command, options) =>
      first(request({ op: "vscode", method: "terminal", args: [command, options ?? {}] })),
    executeCommand: (command, ...args) =>
      first(request({ op: "vscode", method: "executeCommand", args: [command, ...args] })),
  };

  const makeCtx = (
    map: PluginMap,
    pluginDir: string,
    isVscode: boolean,
    webview: PluginWebview | undefined,
  ): PluginCtx => {
    const created = {
      map,
      pluginDir,
      isVscode,
      webview,
      resolve: (address: string, from?: string) => resolveAddress(address, map, from),
      log: (...parts: unknown[]) =>
        io.log(
          parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "),
        ),
      object: (address: string) => request<PluginObject | undefined>({ op: "object", address }),
      children: (address: string) => request<PluginObject[]>({ op: "children", address }),
      tree: (address: string, depth: number) =>
        request<MapObject | undefined>({
          op: "tree",
          address,
          depth: Number.isFinite(depth) ? depth : null,
        }),
      editMap: (ops: MapEditOp[]) => first(request<MapEditResult>({ op: "editMap", ops })),
      undoEdit: (id: string) => first(request<MapEditResult>({ op: "undoEdit", batch: id })),
      redoEdit: (id: string) => first(request<MapEditResult>({ op: "redoEdit", batch: id })),
      plugin: (path: string): PluginClient => ({
        call: <T>(method: string, args?: unknown) =>
          request<T>({
            op: "plugin",
            path: isAbsolute(slash(path)) ? slash(path) : joinPath(pluginDir, path),
            method,
            args: args ?? {},
          }),
      }),
    } as Omit<PluginCtx, "vscode">;
    // Геттер неперечисляемый: `console.log(ctx)` и `{ ...ctx }` без редактора не падают.
    Object.defineProperty(created, "vscode", {
      enumerable: false,
      get: () => {
        if (!isVscode) throw new Error("редактора нет: платформа запущена без VS Code");
        return vscode;
      },
    });
    return created as PluginCtx;
  };

  const describe = (): PluginDescription => ({
    ...(definition.description === undefined ? {} : { description: definition.description }),
    activation: definition.activation ?? {},
    methods: Object.fromEntries(
      Object.entries(definition.methods).map(([name, method]) => [
        name,
        {
          kind: method.kind ?? "query",
          ...(method.description === undefined ? {} : { description: method.description }),
          ...(method.params === undefined ? {} : { params: method.params }),
          ...(method.result === undefined ? {} : { result: method.result }),
        },
      ]),
    ),
    ...(definition.templates === undefined ? {} : { templates: definition.templates }),
  });

  const call = (id: string, name: string, args: unknown) => {
    const method = definition.methods[name];
    if (!ctx || !method) {
      io.send({ t: "error", id, message: `у плагина нет метода ${name}` });
      return;
    }
    // Аргументы шлёт кто угодно — агент, форма, компонент, — и метод их получает уже по схеме.
    if (method.params !== undefined) {
      const errors = schemaErrors(method.params, args);
      if (errors.length > 0) {
        io.send({ t: "error", id, message: `аргументы ${name} не по схеме: ${errors.join("; ")}` });
        return;
      }
    }
    // Тип — `Observable`, но платформе хватает `subscribe`: поток из чужой копии rxjs тоже годится.
    let stream: Observable<unknown>;
    try {
      stream = method.run(args as never, ctx);
    } catch (error) {
      io.send({ t: "error", id, message: message(error) });
      return;
    }
    if (!stream || typeof stream.subscribe !== "function") {
      io.send({ t: "error", id, message: `метод ${name} должен вернуть observable` });
      return;
    }
    const subscription = stream.subscribe({
      next: (value) => io.send({ t: "next", id, value }),
      error: (error) => {
        calls.delete(id);
        io.send({ t: "error", id, message: message(error) });
      },
      complete: () => {
        calls.delete(id);
        io.send({ t: "complete", id });
      },
    });
    // Поток мог кончиться прямо в `subscribe` — тогда держать его не за чем.
    if (!stopping) calls.set(id, subscription);
  };

  const shutdown = async () => {
    stopping = true;
    for (const subscription of calls.values()) subscription.unsubscribe();
    calls.clear();
    try {
      if (ctx) await definition.dispose?.(ctx);
    } catch (error) {
      io.log(`dispose упал: ${message(error)}`);
    }
    for (const id of requests.keys()) io.send({ t: "release", id });
    requests.clear();
    io.send({ t: "disposed" });
    io.exit(0);
  };

  io.onMessage((incoming) => {
    switch (incoming.t) {
      case "hello": {
        ctx = makeCtx(incoming.map, incoming.pluginDir, incoming.isVscode, incoming.webview);
        const ready = ctx;
        void Promise.resolve()
          .then(() => definition.init?.(ready))
          .then(
            () => io.send({ t: "ready", description: describe() }),
            (error: unknown) => io.send({ t: "failed", message: `init упал: ${message(error)}` }),
          );
        return;
      }
      case "call":
        call(incoming.id, incoming.method, incoming.args);
        return;
      case "cancel":
        calls.get(incoming.id)?.unsubscribe();
        calls.delete(incoming.id);
        return;
      case "shutdown":
        void shutdown();
        return;
      case "rnext":
        requests.get(incoming.id)?.next(incoming.value);
        return;
      case "rerror": {
        const sink = requests.get(incoming.id);
        requests.delete(incoming.id);
        sink?.error(new Error(incoming.message));
        return;
      }
      case "rcomplete": {
        const sink = requests.get(incoming.id);
        requests.delete(incoming.id);
        sink?.complete();
        return;
      }
    }
  });
}

/** Среды у пакета нет — он не знает, где запущен; процесс и консоль даёт node плагина. */
type Console = { log: (...parts: unknown[]) => void; info: (...parts: unknown[]) => void };

type NodeProcess = {
  stdin: {
    setEncoding(encoding: string): void;
    on(event: string, listener: (chunk: string) => void): void;
  };
  stdout: { write(text: string): boolean };
  stderr: { write(text: string): boolean };
  exit(code: number): never;
};

/**
 * Точка входа сборки: stdio процесса — канал до платформы. stdout занят протоколом, поэтому
 * `console.log` уводится в stderr — иначе случайная печать ломает разговор.
 */
export function startStdio(definition: PluginDefinition): void {
  const { process: proc, console } = globalThis as unknown as {
    process: NodeProcess;
    console: Console;
  };
  const toErr = (...parts: unknown[]) => {
    proc.stderr.write(
      `${parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ")}\n`,
    );
  };
  console.log = toErr;
  console.info = toErr;

  const handlers: ((message: PlatformMessage) => void)[] = [];
  let buffer = "";
  proc.stdin.setEncoding("utf8");
  proc.stdin.on("data", (chunk) => {
    buffer += chunk;
    let at = buffer.indexOf("\n");
    while (at !== -1) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) {
        try {
          const parsed = JSON.parse(line) as PlatformMessage;
          for (const handler of handlers) handler(parsed);
        } catch (error) {
          toErr(`плагин не понял строку платформы: ${message(error)}`);
        }
      }
      at = buffer.indexOf("\n");
    }
  });
  // Платформа ушла — уходит и плагин: сирота с открытыми вотчерами никому не нужен.
  proc.stdin.on("end", () => proc.exit(0));

  runPlugin(definition, {
    send: (outgoing) => {
      proc.stdout.write(`${JSON.stringify(outgoing)}\n`);
    },
    onMessage: (handler) => {
      handlers.push(handler);
    },
    log: (text) => {
      proc.stderr.write(`${text}\n`);
    },
    exit: (code) => proc.exit(code),
  });
}
