import { exec, spawn } from "node:child_process";
import * as vscode from "vscode";
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
  async read(path: string): Promise<string | undefined> {
    try {
      return decode(await vscode.workspace.fs.readFile(uri(path)));
    } catch {
      return undefined;
    }
  },

  async list(path: string): Promise<FileEntry[]> {
    try {
      return (await vscode.workspace.fs.readDirectory(uri(path))).map(([name, type]) => ({
        name,
        isDirectory: type === vscode.FileType.Directory,
      }));
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
   * читается из её текста.
   */
  watch(root: string, onChange: (path: string) => void): () => void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(uri(root), "**/*.{json,md}"),
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
  options: { cwd: string; env: ProcessEnv; input?: string; cancel?: Cancellation; shell: boolean },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
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
  run(params: { prompt: string; cwd: string; env: ProcessEnv; cancel?: Cancellation }) {
    return runProcess("claude", {
      cwd: params.cwd,
      env: params.env,
      input: params.prompt,
      cancel: params.cancel,
      shell: process.platform === "win32",
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
    // Редактор умеет всё: терминалы, открыть файл, спросить строку, показать текст без файла
    // на диске — решения 0014 и 0019.
    capabilities: { terminals: true, openFile: true, ask: true, virtualDocs: true },
  };
}
