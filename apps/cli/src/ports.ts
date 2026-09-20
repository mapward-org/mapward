import { exec, spawn } from "node:child_process";
import { readdir, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import type {
  Cancellation,
  FileEntry,
  ProcessEnv,
  ProcessResult,
  ServerPorts,
} from "@mapward/abstract-server";

/**
 * Порты сервера со стороны терминала — решение 0014. Та же модель, что в редакторе, только
 * файлы читает `node`, а терминалов и диалогов у неё нет.
 */

const files = {
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

  watch(root: string, onChange: (path: string) => void): () => void {
    const watcher = watch(root, { recursive: true }, (_event, name) => {
      if (name) onChange(`${root}/${String(name)}`);
    });
    return () => watcher.close();
  },
};

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
          options.cancel?.onCancel(() => child.kill());
        });
      },
      pipe(command, options) {
        return runProcess(command, { ...options, shell: true });
      },
    },

    agent: {
      run(params) {
        return runProcess("claude", {
          cwd: params.cwd,
          env: params.env,
          input: params.prompt,
          cancel: params.cancel,
          shell: process.platform === "win32",
        });
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
     * Ни терминала редактора, ни вкладки под текст без файла у cli нет, и клиент узнаёт об
     * этом заранее — решения 0014 и 0019.
     */
    capabilities: { terminals: false, openFile: false, ask: false, virtualDocs: false },
  };
}
