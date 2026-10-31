import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch as watchFs, type FSWatcher } from "node:fs";
import process from "node:process";
import {
  definePlugin,
  excluded,
  fillInputs,
  globBase,
  matchesAny,
  runMessage,
  type PluginClient,
  type RunMessage,
} from "@mapward/plugin";
import { Observable, type Unsubscribable } from "rxjs";
import { Type, type Static } from "typebox";

/**
 * Команды оболочки. Для экшона — `run` и `steps`: вывод уходит сообщениями о ходе по строкам, по
 * мере появления, и окно прогона показывает их сразу. Для метрики — `json`: вывод команды —
 * значение, разобранное json-ом. Отписка — остановка: процесс снимается вместе с детьми.
 *
 * Это код проекта: правь под себя.
 */

const COMMAND = Type.String({ description: "команда оболочки" });
const CWD = Type.String({ description: "рабочая папка; по умолчанию папка карты" });
const ENV = Type.Record(Type.String(), Type.String(), {
  description: "переменные окружения поверх своих",
});
const INPUTS = Type.Record(Type.String(), Type.Unknown(), {
  description:
    "данные формы экшона: ${{ inputs.<имя> }} в команде, MAPWARD_INPUTS и MAPWARD_INPUT_<ИМЯ> в окружении, JSON в stdin",
});
const TIMEOUT = Type.Number({ description: "мс на всё; вышло — процесс снимается" });

const RUN = Type.Object({
  command: COMMAND,
  cwd: Type.Optional(CWD),
  env: Type.Optional(ENV),
  /** Без него, но с `inputs`, в stdin уходят данные формы JSON-ом. */
  input: Type.Optional(Type.String({ format: "multiline", description: "что отдать в stdin" })),
  inputs: Type.Optional(INPUTS),
  timeout: Type.Optional(TIMEOUT),
});

type Env = Record<string, string>;
type Inputs = Record<string, unknown>;
type RunArgs = Static<typeof RUN>;

type Step = { kind?: unknown; name?: unknown; command?: unknown; run?: unknown } & Inputs;

type StepsArgs = {
  steps: Step[];
  env?: Env;
  inputs?: Inputs;
  timeout?: number;
};

/** Итог команды: вывод уже ушёл сообщениями, повторять его незачем. */
type Done = { code: 0 };

/** `MAPWARD_INPUT_<ИМЯ>` — скрипту, которому JSON во входе разбирать незачем. */
function inputEnv(values: Inputs): Env {
  return Object.fromEntries([
    ["MAPWARD_INPUTS", JSON.stringify(values)],
    ...Object.entries(values).map(([name, value]) => [
      `MAPWARD_INPUT_${name.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_")}`,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  ]);
}

/**
 * Снять процесс вместе с детьми: через оболочку `kill` снимает саму оболочку, а скрипт под ней
 * живёт дальше. На Windows дерево снимает `taskkill /T`; на остальных процесс заведён своей
 * группой, и снимается группа целиком.
 */
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

/** Поток по строкам: кусок вывода режется на строки, хвост ждёт следующего куска. */
function lines(emit: (line: string) => void): { feed(chunk: string): void; flush(): void } {
  let buffer = "";
  return {
    feed(chunk) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) emit(part.replace(/\r$/, ""));
    },
    flush() {
      if (buffer !== "") emit(buffer.replace(/\r$/, ""));
      buffer = "";
    },
  };
}

function run(args: RunArgs, mapPath: string): Observable<RunMessage | Done> {
  return new Observable<RunMessage | Done>((sink) => {
    const values = args.inputs;
    const command = values ? fillInputs(args.command, values) : args.command;
    const child = spawn(command, {
      cwd: args.cwd ?? mapPath,
      env: { ...process.env, ...args.env, ...(values ? inputEnv(values) : {}) },
      shell: true,
      windowsHide: true,
      // Своя группа — чтобы остановка могла снять и детей; на Windows это делает `taskkill`.
      detached: process.platform !== "win32",
    });

    let expired = false;
    const timer =
      args.timeout === undefined
        ? undefined
        : setTimeout(() => {
            expired = true;
            killTree(child);
          }, args.timeout);

    // Кодировка на потоке, а не `toString()` куска: русская буква на границе кусков иначе бьётся.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const out = lines((text) => sink.next({ progress: "out", text }));
    const tail: string[] = [];
    const err = lines((text) => {
      tail.push(text);
      tail.splice(0, Math.max(0, tail.length - 20));
      sink.next({ progress: "log", text });
    });
    child.stdout.on("data", (chunk: string) => out.feed(chunk));
    child.stderr.on("data", (chunk: string) => err.feed(chunk));

    child.on("error", (error) => {
      // Нет папки `cwd` — node винит оболочку: «spawn cmd.exe ENOENT». Называем настоящую причину.
      const cwd = args.cwd ?? mapPath;
      sink.error(
        (error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(cwd)
          ? new Error(`нет папки cwd: ${cwd}`)
          : error,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out.flush();
      err.flush();
      if (expired) sink.error(new Error(`время вышло, предел ${args.timeout} мс`));
      else if (code === 0) {
        sink.next({ code: 0 });
        sink.complete();
      } else sink.error(new Error(tail.join("\n").trim() || `команда вернула ${String(code)}`));
    });

    const input = args.input ?? (values ? JSON.stringify(values) : undefined);
    child.stdin.on("error", () => {});
    child.stdin.end(input);

    return () => {
      clearTimeout(timer);
      killTree(child);
    };
  });
}

/**
 * Шаги по очереди: следующий — после того, как предыдущий сделал своё; упал один — остальные не
 * идут. `script` — команда здесь же, `prompt` — плагин `agent` рядом.
 */
function steps(args: StepsArgs, mapPath: string, agent: PluginClient): Observable<RunMessage> {
  return new Observable<RunMessage>((sink) => {
    let current: Unsubscribable | undefined;
    const timer =
      args.timeout === undefined
        ? undefined
        : setTimeout(() => {
            current?.unsubscribe();
            sink.error(new Error(`время вышло, предел ${args.timeout} мс`));
          }, args.timeout);
    const common = {
      ...(args.env === undefined ? {} : { env: args.env }),
      ...(args.inputs === undefined ? {} : { inputs: args.inputs }),
    };

    const next = (at: number) => {
      const step = args.steps[at];
      if (!step) {
        clearTimeout(timer);
        sink.complete();
        return;
      }
      const kind = String(step.kind);
      sink.next({ progress: "step", name: String(step.name ?? step.kind ?? at + 1) });
      const stream: Observable<unknown> | undefined =
        kind === "script"
          ? run({ command: String(step.command ?? step.run ?? ""), ...common }, mapPath)
          : kind === "prompt"
            ? agent.call("run", {
                prompt: String(step.prompt ?? ""),
                ...(step.permissions === undefined ? {} : { permissions: step.permissions }),
                ...common,
              })
            : undefined;
      if (!stream) {
        sink.error(new Error(`Исполнитель ${kind} ещё не поддержан`));
        return;
      }
      current = stream.subscribe({
        // Итог шага в прогон не идёт: что шаг сделал, уже пришло сообщениями.
        next: (value) => {
          const message = runMessage(value);
          if (message) sink.next(message);
        },
        error: (error) => sink.error(error),
        complete: () => next(at + 1),
      });
    };

    if (args.steps.length === 0) sink.error(new Error("у экшона нет ни одного исполнителя"));
    else next(0);

    return () => {
      clearTimeout(timer);
      current?.unsubscribe();
    };
  });
}

/** Что сторожит `json`: глобы — абсолютные или от `cwd`; `debounce` — мс тишины. */
const WATCH = Type.Object(
  {
    include: Type.Array(Type.String(), { description: "глобы: абсолютные или от cwd" }),
    exclude: Type.Optional(Type.Array(Type.String())),
    debounce: Type.Optional(Type.Number({ description: "мс тишины; по умолчанию 300" })),
  },
  { description: "перезапускать по изменению файлов, пока подписан" },
);

/** Вход команды — поток другого метода: каждое его значение уходит в stdin JSON-ом. */
const FROM = Type.Object(
  { plugin: Type.String(), method: Type.String(), params: Type.Optional(Type.Unknown()) },
  {
    description:
      "вход — поток другого метода: { plugin, method, params }; plugin — абсолютный путь или от папки этого плагина",
  },
);

const JSON_ARGS = Type.Object({
  command: COMMAND,
  cwd: Type.Optional(CWD),
  env: Type.Optional(ENV),
  watch: Type.Optional(WATCH),
  from: Type.Optional(FROM),
  timeout: Type.Optional(TIMEOUT),
});

type Watch = Static<typeof WATCH>;
type JsonArgs = Static<typeof JSON_ARGS>;

/** Правка пишет файл несколько раз подряд: ждём тишины, а не первого тика. */
const QUIET_MS = 300;

const slash = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");
const isAbsolute = (path: string): boolean => /^([A-Za-z]:)?\//.test(path);
const full = (cwd: string, path: string): string =>
  isAbsolute(slash(path)) ? slash(path) : `${slash(cwd)}/${slash(path)}`;
/** Регистр не сверяется: на Windows редактор и конфиг пишут диск по-разному. */
const lower = (paths: string[]): string[] => paths.map((path) => path.toLowerCase());

/**
 * Вотчер на глобы `watch`: папка под вотчером — всё до первого сегмента с глобом, изменение
 * сверяется с полными глобами. Папки может не быть — тогда за ней не следят, команда идёт как шла.
 */
function watchGlobs(spec: Watch, cwd: string, onChange: () => void): () => void {
  const include = lower(spec.include.map((glob) => full(cwd, glob)));
  const exclude = lower((spec.exclude ?? []).map((glob) => full(cwd, glob)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];
  for (const base of new Set(include.map((glob) => globBase(glob) || slash(cwd)))) {
    try {
      const watcher = watchFs(base, { recursive: true }, (_event, name) => {
        if (name === null) return;
        const path = `${base}/${slash(String(name))}`.toLowerCase();
        if (!matchesAny(path, include) || excluded(path, exclude)) return;
        clearTimeout(timer);
        timer = setTimeout(onChange, spec.debounce ?? QUIET_MS);
      });
      watcher.on("error", () => watcher.close());
      watchers.push(watcher);
    } catch {
      // Нет папки — нечего сторожить.
    }
  }
  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

/** Ответ команды: json, а не json — текстом, чтобы его хотя бы показал вид `text`. */
function parseOutput(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { text: trimmed };
  }
}

/**
 * Команда как значение метрики — то, что раньше было коллектором `script`, а с `from` — и
 * трансформом `script`: вход — значение другого метода, выход — значение этого. Поток живёт, пока
 * подписан: `watch` перезапускает команду по изменению файлов, `from` — по новому входу; без них
 * значение одно, и поток кончается. Объект для команды — подстановками в `command` и `env`.
 */
function json(
  args: JsonArgs,
  mapPath: string,
  plugin: (path: string) => PluginClient,
): Observable<unknown> {
  return new Observable<unknown>((sink) => {
    const cwd = args.cwd ?? mapPath;
    const lasting = args.watch !== undefined || args.from !== undefined;
    let current: Unsubscribable | undefined;
    let input: string | undefined;

    const start = () => {
      current?.unsubscribe();
      const out: string[] = [];
      current = run(
        {
          command: args.command,
          cwd,
          ...(args.env === undefined ? {} : { env: args.env }),
          ...(input === undefined ? {} : { input }),
          ...(args.timeout === undefined ? {} : { timeout: args.timeout }),
        },
        mapPath,
      ).subscribe({
        next: (value) => {
          const message = value as { progress?: string; text?: string };
          if (message.progress === "out") out.push(message.text ?? "");
        },
        error: (error) => sink.error(error),
        complete: () => {
          sink.next(parseOutput(out.join("\n")));
          if (!lasting) sink.complete();
        },
      });
    };

    const source = args.from
      ? plugin(args.from.plugin)
          .call(args.from.method, args.from.params ?? {})
          .subscribe({
            next: (value) => {
              input = JSON.stringify(value ?? null);
              start();
            },
            error: (error) => sink.error(error),
          })
      : undefined;
    if (!args.from) start();

    // С `from` перезапускать без входа нечего: первый запуск даст сам вход.
    const stopWatch = args.watch
      ? watchGlobs(args.watch, cwd, () => {
          if (!args.from || input !== undefined) start();
        })
      : () => {};

    return () => {
      stopWatch();
      source?.unsubscribe();
      current?.unsubscribe();
    };
  });
}

const STEPS = Type.Object({
  steps: Type.Array(
    Type.Object({
      kind: Type.Union([Type.Literal("script"), Type.Literal("prompt")]),
      name: Type.Optional(Type.String()),
      command: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
      permissions: Type.Optional(Type.Unknown()),
    }),
  ),
  env: Type.Optional(ENV),
  inputs: Type.Optional(INPUTS),
  timeout: Type.Optional(TIMEOUT),
});

export default definePlugin({
  description:
    "Команды оболочки: для экшона — вывод по строкам по мере появления (run, steps), для метрики — вывод значением (json)",
  methods: {
    json: {
      description:
        "Значение метрики — вывод команды, разобранный json-ом (не json — { text }). С watch перезапускается по изменению файлов, с from — по каждому значению другого метода, которое уходит в stdin JSON-ом; без них значение одно. Ненулевой код — ошибка с хвостом stderr",
      params: JSON_ARGS,
      run: (args, ctx) => json(args, ctx.map.mapPath, (path) => ctx.plugin(path)),
    },
    run: {
      kind: "mutation",
      description:
        "Выполнить команду оболочкой. Сообщения — строки вывода: { progress: 'out' | 'log', text }; итог — { code: 0 }. Ненулевой код — ошибка с хвостом stderr",
      params: RUN,
      run: (args, ctx) => run(args, ctx.map.mapPath),
    },
    steps: {
      kind: "mutation",
      description:
        "Шаги по очереди: { kind: 'script', command } — команда, { kind: 'prompt', prompt, permissions } — агент плагином agent рядом. Перед каждым шагом — { progress: 'step', name }",
      params: STEPS,
      run: (args: StepsArgs, ctx) => steps(args, ctx.map.mapPath, ctx.plugin("../agent")),
    },
  },
});
