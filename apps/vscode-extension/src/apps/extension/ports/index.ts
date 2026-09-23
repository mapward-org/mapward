import { exec, spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { claudeArgs, shellArgs } from "@mapward/abstract-server";
import type { ActionPermissions } from "@mapward/core";
import type {
  Cancellation,
  FileEntry,
  ProcessEnv,
  ProcessResult,
  ServerPorts,
} from "@mapward/abstract-server";

/**
 * Реализации портов сервера для редактора — решение 0014. Всё, что знает про `vscode` и про
 * `node`, живёт здесь; сервер об этом не знает ничего.
 */

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const encode = (text: string) => new TextEncoder().encode(text);
const uri = (path: string) => vscode.Uri.file(path);

const files = {
  /** У `workspace.fs` ссылок нет, а сборке компонента нужен настоящий путь пакета (0037). */
  async realpath(path: string): Promise<string | undefined> {
    try {
      return await realpath(path);
    } catch {
      return undefined;
    }
  },

  async read(path: string): Promise<string | undefined> {
    try {
      return decode(await vscode.workspace.fs.readFile(uri(path)));
    } catch {
      return undefined;
    }
  },

  async list(path: string): Promise<FileEntry[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(uri(path));
      return await Promise.all(
        entries.map(async ([name, type]) => {
          if (type === vscode.FileType.Directory) return { name, isDirectory: true };
          // Размера в `readDirectory` нет, поэтому файлы опрашиваются отдельно. Не получилось —
          // размер просто не называется: список важнее, чем число рядом с ним.
          const size = await vscode.workspace.fs.stat(uri(`${path}/${name}`)).then(
            (found) => found.size,
            () => undefined,
          );
          return { name, isDirectory: false, ...(size === undefined ? {} : { size }) };
        }),
      );
    } catch {
      return [];
    }
  },

  async write(path: string, text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri(path), encode(text));
  },

  /**
   * В корзину, а не мимо: удаляют обычно случайно созданное, но ошибиться можно и тут, и тогда
   * файл достаётся обратно средствами системы. Файла не было — удаление уже случилось.
   */
  async remove(path: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri(path), { useTrash: true });
    } catch {
      // нечего удалять
    }
  },

  /**
   * Markdown считается картой наравне с json: директивы и экшоны — `.md`, и статус директивы
   * читается из её текста. За чем следить, вправе сказать зовущий — решение 0023: у `.git/index`
   * расширения нет вовсе, и под умолчание он не подходит.
   */
  watch(
    root: string,
    onChange: (path: string) => void,
    options?: { include?: string[] },
  ): () => void {
    const include = options?.include ?? [];
    const pattern =
      include.length === 0
        ? "**/*.{json,md}"
        : include.length === 1
          ? (include[0] as string)
          : `{${include.join(",")}}`;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(uri(root), pattern),
    );
    const handle = (changed: vscode.Uri) => onChange(changed.fsPath);
    watcher.onDidCreate(handle);
    watcher.onDidChange(handle);
    watcher.onDidDelete(handle);
    return () => watcher.dispose();
  },
};

/** Процесс, который можно убить: отмена приходит токеном от стора метрик. */
function runProcess(
  command: string,
  options: {
    cwd: string;
    env: ProcessEnv;
    input?: string;
    cancel?: Cancellation;
    shell: boolean;
    args?: string[];
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, shellArgs(options.args ?? [], options.shell), {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: options.shell,
    });

    options.cancel?.onCancel(() => child.kill());

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (error) => reject(error));
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(stderr.trim() || `команда вернула ${String(code)}`)),
    );

    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

const shell = {
  run(command: string, options: { cwd: string; env: ProcessEnv; cancel?: Cancellation }) {
    return new Promise<ProcessResult>((resolve, reject) => {
      const child = exec(
        command,
        { cwd: options.cwd, env: options.env, windowsHide: true },
        (error, stdout, stderr) =>
          error ? reject(error) : resolve({ stdout: String(stdout), stderr: String(stderr) }),
      );
      options.cancel?.onCancel(() => child.kill());
    });
  },

  pipe(
    command: string,
    options: { cwd: string; env: ProcessEnv; input: string; cancel?: Cancellation },
  ) {
    return runProcess(command, { ...options, shell: true });
  },
};

/**
 * Агент в headless-режиме — решение 0004. Промпт уходит в stdin, поэтому правила экранирования
 * трёх оболочек перестают быть нашей заботой.
 */
const agent = {
  run(params: {
    prompt: string;
    cwd: string;
    env: ProcessEnv;
    cancel?: Cancellation;
    permissions?: ActionPermissions;
  }) {
    return runProcess("claude", {
      cwd: params.cwd,
      env: params.env,
      input: params.prompt,
      cancel: params.cancel,
      shell: process.platform === "win32",
      args: claudeArgs(params.permissions),
    });
  },
};

export function createPorts(): ServerPorts {
  return {
    files,
    shell,
    agent,
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
    // `.wasm` esbuild копируется в `dist` при сборке: в `.vsix` едет только он (решение 0037).
    bundler: { wasm: () => readFile(join(__dirname, "esbuild.wasm")) },
    // Редактор умеет всё: терминалы, открыть файл, спросить строку, показать текст без файла
    // на диске и открыть объект табом — решения 0014, 0019 и 0026.
    capabilities: { terminals: true, openFile: true, ask: true, virtualDocs: true, tabs: true },
  };
}
