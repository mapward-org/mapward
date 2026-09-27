import { exec, spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import {
  CLAUDE_STREAM_ARGS,
  claudeArgs,
  claudeStream,
  matchesGlob,
  shellArgs,
} from "@mapward/abstract-server";
import type {
  Cancellation,
  FileEntry,
  OutputListener,
  ProcessEnv,
  ProcessResult,
  ServerPorts,
} from "@mapward/abstract-server";

/**
 * Порты сервера со стороны терминала — решение 0014. Та же модель, что в редакторе, только
 * файлы читает `node`, а терминалов и диалогов у неё нет.
 */

const files = {
  async realpath(path: string): Promise<string | undefined> {
    try {
      return await realpath(path);
    } catch {
      return undefined;
    }
  },

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return undefined;
    }
  },

  async list(path: string): Promise<FileEntry[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return await Promise.all(
        entries.map(async (entry) => {
          if (entry.isDirectory()) return { name: entry.name, isDirectory: true };
          // Размера в `readdir` нет, поэтому файлы опрашиваются отдельно. Не получилось —
          // размер просто не называется: список важнее, чем число рядом с ним.
          const size = await stat(join(path, entry.name)).then(
            (found) => found.size,
            () => undefined,
          );
          return { name: entry.name, isDirectory: false, ...(size === undefined ? {} : { size }) };
        }),
      );
    } catch {
      return [];
    }
  },

  async write(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
  },

  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  },

  /** Перенос папки объекта — правка карты (решение 0044). Занятую цель не затирает. */
  async move(from: string, to: string): Promise<void> {
    const taken = await stat(to).then(
      () => true,
      () => false,
    );
    if (taken) throw new Error(`${to} уже есть`);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  },

  /**
   * За чем следить, вправе сказать зовущий — решение 0023: имена сверяются с `include`. Глоб там
   * тоже бывает — это вотчер шага метрики (решение 0043), и он сверяется от `root`.
   */
  watch(
    root: string,
    onChange: (path: string) => void,
    options?: { include?: string[] },
  ): () => void {
    const include = options?.include;
    const watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      const path = String(name).replaceAll("\\", "/");
      // Имена вроде `index` и `HEAD` сверяются целиком, глобы — глобом.
      const hit = (wanted: string) =>
        path === wanted || path.endsWith(`/${wanted}`) || matchesGlob(path, wanted);
      if (include && !include.some(hit)) {
        return;
      }
      onChange(`${root}/${path}`);
    });
    return () => watcher.close();
  },
};

/**
 * Снять процесс вместе с детьми. Через оболочку `kill` снимает саму оболочку, а `claude` или
 * скрипт под ней живут дальше — поэтому «остановить» не останавливало ничего (решение 0038).
 * На Windows дерево снимает `taskkill /T`; на остальных процесс заведён своей группой, и снимается
 * группа целиком.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
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

function runProcess(
  command: string,
  options: {
    cwd: string;
    env: ProcessEnv;
    input?: string;
    cancel?: Cancellation;
    shell: boolean;
    args?: string[];
    output?: OutputListener;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, shellArgs(options.args ?? [], options.shell), {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: options.shell,
      // Своя группа — чтобы отмена могла снять и детей; на Windows это делает `taskkill`.
      detached: process.platform !== "win32",
    });

    options.cancel?.onCancel(() => killTree(child));

    let stdout = "";
    let stderr = "";
    // Кодировка на потоке, а не `toString()` куска: русская буква на границе кусков иначе бьётся.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      options.output?.(chunk, "out");
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      options.output?.(chunk, "err");
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(stderr.trim() || `команда вернула ${String(code)}`)),
    );

    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

export function createPorts(): ServerPorts {
  return {
    files,

    shell: {
      run(command, options) {
        return new Promise<ProcessResult>((resolve, reject) => {
          const child = exec(
            command,
            { cwd: options.cwd, env: options.env, windowsHide: true },
            (error, stdout, stderr) =>
              error ? reject(error) : resolve({ stdout: String(stdout), stderr: String(stderr) }),
          );
          // Итог по-прежнему отдаёт `exec` целиком, а по ходу вывод уходит слушателю.
          child.stdout?.on("data", (chunk: Buffer | string) =>
            options.output?.(String(chunk), "out"),
          );
          child.stderr?.on("data", (chunk: Buffer | string) =>
            options.output?.(String(chunk), "err"),
          );
          options.cancel?.onCancel(() => killTree(child));
        });
      },
      pipe(command, options) {
        return runProcess(command, { ...options, shell: true });
      },
    },

    agent: {
      // События агента — строками слушателю, итогом последний ответ: так же, как в редакторе.
      run(params) {
        const stream = claudeStream(params.output);
        return runProcess("claude", {
          cwd: params.cwd,
          env: params.env,
          input: params.prompt,
          cancel: params.cancel,
          shell: process.platform === "win32",
          args: [...CLAUDE_STREAM_ARGS, ...claudeArgs(params.permissions)],
          output: stream.listener,
        }).then(stream.finish);
      },
    },

    clock: { now: () => new Date().toISOString() },

    timers: {
      every(ms, run) {
        const timer = setInterval(run, ms);
        return () => clearInterval(timer);
      },
      after(ms, run) {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
    },

    env: { vars: () => process.env },

    /**
     * `.wasm` esbuild лежит в `node_modules` рядом с cli — решение 0037: cli ставится пакетом,
     * и его зависимости с ним.
     */
    bundler: {
      wasm: async () => {
        const require = createRequire(import.meta.url);
        const dir = dirname(require.resolve("esbuild-wasm/package.json"));
        return readFile(join(dir, "esbuild.wasm"));
      },
    },

    /**
     * Ни терминала редактора, ни вкладки под текст без файла у cli нет, и клиент узнаёт об
     * этом заранее — решения 0014 и 0019.
     */
    capabilities: {
      terminals: false,
      openFile: false,
      ask: false,
      virtualDocs: false,
      tabs: false,
    },
  };
}
