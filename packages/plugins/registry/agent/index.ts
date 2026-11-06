import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { definePlugin, fillInputs, TRACE_ENV, TRACE_HEADER, type PluginCtx } from "@mapward/plugin";
import { Observable } from "rxjs";
import { Type, type Static } from "typebox";
import { parseAnswer } from "./answer.ts";
import { shapeHint } from "./shape.ts";

/**
 * Агент в headless-режиме: `claude -p`, промпт в stdin, ход агента потоком событий. Ход
 * («→ Read файл», «→ Bash команда», текст) уходит в лог вызова (`ctx.log`) по мере прихода, ответ —
 * выводом (`ctx.output`) и итогом. Отписка — остановка.
 *
 * Трейс вызова агент получает переменной `MAPWARD_TRACE` и заголовком MCP карты: всё, что он
 * сделает через карту, ляжет в тот же трейс, и отмена экшона снимет и это.
 *
 * `run` — один вопрос для экшона. `ask` и `refresh` — метрика: спрашивать агента дорого, поэтому
 * `ask` отдаёт сохранённый ответ из файла `cache`, а новый ответ даёт только `refresh` — кнопка.
 * Файл кэша — артефакт рядом с объектом, его коммитят: ответ видят все, кто открыл карту.
 *
 * Чем звать агента, можно переопределить переменной `MAPWARD_AGENT_COMMAND` — строкой оболочки:
 * так его подменяют в тестах. Это код проекта: правь под себя.
 */

const PERMISSIONS = Type.Union([Type.Literal("bypass"), Type.Array(Type.String())], {
  description:
    "что агенту можно: 'bypass' — всё без вопросов, список — инструменты, как их понимает claude (Read, Edit, Bash(pnpm build:*))",
});

const CWD = Type.String({ description: "рабочая папка; по умолчанию корень проекта" });
const TIMEOUT = Type.Number({ description: "мс на всё; вышло — агент снимается" });

const RUN = Type.Object({
  prompt: Type.String({ format: "multiline", description: "что сделать" }),
  permissions: Type.Optional(PERMISSIONS),
  cwd: Type.Optional(CWD),
  env: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "переменные окружения поверх своих",
    }),
  ),
  inputs: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description:
        "данные формы экшона: ${{ inputs.<имя> }} в промпте и строкой в его конце, MAPWARD_INPUT_<ИМЯ> в окружении",
    }),
  ),
  timeout: Type.Optional(TIMEOUT),
});

type Env = Record<string, string>;
type Inputs = Record<string, unknown>;
type Permissions = Static<typeof PERMISSIONS>;
type RunArgs = Static<typeof RUN>;

/** Итог: последний ответ агента. */
type Answer = { answer: string };

/** Агент с ходом по ходу: `claude` печатает события строками JSON, а не один ответ в конце. */
const STREAM_ARGS = ["-p", "--output-format", "stream-json", "--verbose"];

/** Разрешения во флаги `claude`: без них агент может только читать — правку одобрить некому. */
function permissionArgs(permissions: Permissions | undefined): string[] {
  if (permissions === undefined) return [];
  if (permissions === "bypass") return ["--dangerously-skip-permissions"];
  return permissions.length === 0 ? [] : ["--allowedTools", ...permissions];
}

/**
 * Через оболочку аргументы уходят одной строкой, и без кавычек `Bash(pnpm build:*)` разъедется
 * на части. Без оболочки процесс получает их массивом, как есть.
 */
const quoted = (args: string[], shell: boolean): string[] =>
  shell ? args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`) : args;

function inputEnv(values: Inputs): Env {
  return Object.fromEntries([
    ["MAPWARD_INPUTS", JSON.stringify(values)],
    ...Object.entries(values).map(([name, value]) => [
      `MAPWARD_INPUT_${name.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_")}`,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  ]);
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}

/** Что сказать об инструменте одной строкой: файл, команда, шаблон — или короткий JSON. */
function toolLine(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  const main = ["file_path", "command", "pattern", "path", "url", "description"]
    .map((key) => fields[key])
    .find((value) => typeof value === "string");
  const about = typeof main === "string" ? main : JSON.stringify(input ?? {});
  return `→ ${name} ${about.length > 160 ? `${about.slice(0, 160)}…` : about}`;
}

/** Промпт целиком: подставленные данные формы и они же строкой в конце. */
function promptOf(args: RunArgs): string {
  const values = args.inputs;
  if (!values) return args.prompt;
  const form =
    Object.keys(values).length === 0
      ? undefined
      : `Данные формы, с которыми запустили экшон: ${JSON.stringify(values)}`;
  return [fillInputs(args.prompt, values), form].filter(Boolean).join("\n\n");
}

/**
 * MCP карты для агента — с трейсом в заголовке: адрес живой платформы лежит в
 * `.mapward/platform.json`. Конфиг — файлом, а не строкой: JSON в аргументах оболочки Windows
 * не переживает кавычек. Платформы нет или трейса нет — агент ходит в MCP, как настроено в проекте.
 */
async function mcpConfig(mapPath: string, trace: string | undefined): Promise<string | undefined> {
  if (trace === undefined) return undefined;
  try {
    const record = JSON.parse(await readFile(`${mapPath}/.mapward/platform.json`, "utf8")) as {
      mcp?: unknown;
    };
    if (typeof record.mcp !== "string") return undefined;
    const file = `${mapPath}/.mapward/agent-mcp/${trace.replaceAll(/[^\w-]/g, "_")}.json`;
    await mkdir(dirname(file), { recursive: true });
    const config = {
      mcpServers: {
        mapward: { type: "http", url: record.mcp, headers: { [TRACE_HEADER]: trace } },
      },
    };
    await writeFile(file, JSON.stringify(config), "utf8");
    return file;
  } catch {
    return undefined;
  }
}

function run(args: RunArgs, ctx: PluginCtx) {
  return new Observable<Answer>((sink) => {
    const trace = ctx.call?.trace;
    let child: ChildProcess | undefined;
    let config: string | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void mcpConfig(ctx.map.mapPath, trace).then((file) => {
      config = file;
      if (stopped) {
        if (file) void rm(file, { force: true });
        return;
      }
      start();
    });

    function options() {
      return {
        // Агент работает с проектом, а не с картой: экшону чаще нужен код.
        cwd: args.cwd ?? ctx.map.basePath,
        env: {
          ...process.env,
          ...args.env,
          ...(args.inputs ? inputEnv(args.inputs) : {}),
          ...(trace === undefined ? {} : { [TRACE_ENV]: trace }),
        },
        windowsHide: true,
        detached: process.platform !== "win32",
      };
    }

    function start() {
      const override = process.env.MAPWARD_AGENT_COMMAND;
      const shell = override !== undefined || process.platform === "win32";
      const flags = quoted(
        [
          ...STREAM_ARGS,
          ...permissionArgs(args.permissions),
          ...(config === undefined ? [] : ["--mcp-config", config]),
        ],
        shell,
      );
      const spawned = override
        ? spawn([override, ...flags].join(" "), { shell: true, ...options() })
        : spawn("claude", flags, { shell, ...options() });
      child = spawned;

      let expired = false;
      timer =
        args.timeout === undefined
          ? undefined
          : setTimeout(() => {
              expired = true;
              killTree(spawned);
            }, args.timeout);

      let answer: string | undefined;
      let lastText: string | undefined;
      const tail: string[] = [];
      const log = (text: string) => ctx.log(text);

      const event = (raw: string) => {
        if (raw.trim() === "") return;
        let parsed: { type?: string; result?: unknown; message?: { content?: unknown } };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          log(raw);
          return;
        }
        if (parsed.type === "result") {
          if (typeof parsed.result === "string") answer = parsed.result;
          return;
        }
        if (parsed.type !== "assistant" || !Array.isArray(parsed.message?.content)) return;
        for (const block of parsed.message.content as Record<string, unknown>[]) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            lastText = block.text;
            log(block.text);
          } else if (block.type === "tool_use") {
            log(toolLine(String(block.name), block.input));
          }
        }
      };

      let buffer = "";
      let errors = "";
      spawned.stdout.setEncoding("utf8");
      spawned.stderr.setEncoding("utf8");
      spawned.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) event(part);
      });
      spawned.stderr.on("data", (chunk: string) => {
        errors += chunk;
        const parts = errors.split("\n");
        errors = parts.pop() ?? "";
        for (const part of parts) {
          tail.push(part);
          log(part);
        }
      });

      spawned.on("error", (error) => sink.error(error));
      spawned.on("close", (code) => {
        clearTimeout(timer);
        if (config) void rm(config, { force: true });
        event(buffer);
        if (errors) {
          tail.push(errors);
          log(errors);
        }
        if (expired) {
          sink.error(new Error(`время вышло, предел ${args.timeout} мс`));
        } else if (code === 0) {
          const text = answer ?? lastText ?? "";
          ctx.output(text);
          sink.next({ answer: text });
          sink.complete();
        } else {
          sink.error(
            new Error(tail.slice(-20).join("\n").trim() || `агент вернул ${String(code)}`),
          );
        }
      });

      spawned.stdin.on("error", () => {});
      spawned.stdin.end(promptOf(args));
    }

    return () => {
      stopped = true;
      clearTimeout(timer);
      if (child) killTree(child);
    };
  });
}

/** Ответ метрики: спрашивали ли, когда, что ответил; `busy` — идёт новый вопрос. */
type Asked =
  | { asked: false; busy?: boolean }
  | { asked: true; updatedAt: string; data: unknown; busy?: boolean };

const ASK = Type.Object({
  prompt: Type.String({ format: "multiline", description: "что спросить" }),
  shape: Type.Optional(
    Type.Unknown({
      description:
        "форма ответа: имя вида (text, markdown, link, status, list, tree) или JSON-схема; подсказка уходит в конец промпта",
    }),
  ),
  cache: Type.String({
    description: "файл ответа, абсолютный путь; обычно рядом с объектом, и его коммитят",
  }),
  permissions: Type.Optional(PERMISSIONS),
  cwd: Type.Optional(CWD),
  timeout: Type.Optional(TIMEOUT),
});

type AskArgs = Static<typeof ASK>;

const ASKED = Type.Object(
  {
    asked: Type.Boolean(),
    updatedAt: Type.Optional(Type.String()),
    data: Type.Optional(Type.Unknown()),
    busy: Type.Optional(Type.Boolean()),
  },
  {
    description:
      "asked — спрашивали ли; updatedAt — когда; data — ответ, разобранный как json (не json — { text }); busy — идёт новый вопрос",
  },
);

/** Кто смотрит на какой файл ответа: новый ответ уходит им сразу, без перечитывания. */
const watchers = new Map<string, Set<(value: Asked) => void>>();
/** Какие файлы сейчас пересобираются: смотрящий видит `busy`, даже если кнопку нажал не он. */
const running = new Map<string, Asked>();

async function readCache(cache: string): Promise<Asked> {
  try {
    const saved = JSON.parse(await readFile(cache, "utf8")) as {
      updatedAt?: unknown;
      data?: unknown;
    };
    return typeof saved.updatedAt === "string"
      ? { asked: true, updatedAt: saved.updatedAt, data: saved.data }
      : { asked: false };
  } catch {
    return { asked: false };
  }
}

const tell = (cache: string, value: Asked) => {
  for (const listener of watchers.get(cache) ?? []) listener(value);
};

function ask(args: AskArgs) {
  return new Observable<Asked>((sink) => {
    let alive = true;
    const listener = (value: Asked) => sink.next(value);
    const listeners = watchers.get(args.cache) ?? new Set();
    listeners.add(listener);
    watchers.set(args.cache, listeners);
    const busy = running.get(args.cache);
    if (busy) sink.next(busy);
    else
      void readCache(args.cache).then((value) => {
        // Пока читали, мог начаться новый вопрос: о нём смотрящему уже сказали.
        if (alive && !running.has(args.cache)) sink.next(value);
      });
    return () => {
      alive = false;
      listeners.delete(listener);
      if (listeners.size === 0) watchers.delete(args.cache);
    };
  });
}

function refresh(args: AskArgs, ctx: PluginCtx) {
  return new Observable<Asked>((sink) => {
    let done = false;
    const finish = () => {
      done = true;
      running.delete(args.cache);
    };
    /** Неудача и отмена прежний ответ не стирают: смотрящим возвращается то, что было. */
    const restore = () => void readCache(args.cache).then((before) => tell(args.cache, before));
    void readCache(args.cache).then((before) => {
      if (done) return;
      const busy = { ...before, busy: true };
      running.set(args.cache, busy);
      tell(args.cache, busy);
    });

    let answer: string | undefined;
    const inner = run(
      {
        prompt: [args.prompt, shapeHint(args.shape)].join("\n\n"),
        ...(args.permissions === undefined ? {} : { permissions: args.permissions }),
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
        ...(args.timeout === undefined ? {} : { timeout: args.timeout }),
      },
      ctx,
    ).subscribe({
      next: (value) => {
        answer = value.answer;
      },
      error: (error) => {
        finish();
        restore();
        sink.error(error);
      },
      complete: () => {
        const value: Asked = {
          asked: true,
          updatedAt: new Date().toISOString(),
          data: parseAnswer(answer ?? ""),
        };
        void (async () => {
          await mkdir(dirname(args.cache), { recursive: true });
          const saved = { updatedAt: value.updatedAt, data: value.data };
          await writeFile(args.cache, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
          finish();
          tell(args.cache, value);
          sink.next(value);
          sink.complete();
        })().catch((error: unknown) => {
          finish();
          restore();
          sink.error(error);
        });
      },
    });

    return () => {
      inner.unsubscribe();
      if (done) return;
      finish();
      restore();
    };
  });
}

export default definePlugin({
  description:
    "Агент в headless-режиме (claude -p): вопрос экшона (run) и сохранённый ответ метрики (ask, refresh)",
  methods: {
    run: {
      kind: "mutation",
      description:
        "Один вопрос агенту. Ход агента — строками в лог плагина, ответ — выводом; итог — { answer }",
      params: RUN,
      run: (args, ctx) => run(args, ctx),
    },
    ask: {
      description:
        "Ответ агента для метрики — сохранённый в cache, без нового вопроса: спрашивать дорого. Новый ответ приходит сюда же, когда его даст refresh",
      params: ASK,
      result: ASKED,
      run: (args) => ask(args),
    },
    refresh: {
      kind: "mutation",
      description:
        "Спросить агента заново и сохранить ответ в cache — кнопка обновления метрики. Ход агента — в лог плагина; итог — новый ответ, как у ask",
      params: ASK,
      result: ASKED,
      run: (args, ctx) => refresh(args, ctx),
    },
  },
});
