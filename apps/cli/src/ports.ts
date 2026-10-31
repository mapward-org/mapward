import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { watch } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { PLUGIN_INSTALL } from "@mapward/abstract-server";
import type { FileEntry, PluginProcess, ProcessEnv, ServerPorts } from "@mapward/abstract-server";

/**
 * Порты сервера со стороны терминала — решение 0014. Та же модель, что в редакторе, только
 * файлы читает `node`, а терминалов и диалогов у неё нет.
 */

/** Номер временного файла записи: сквозной на процесс. */
let temp = 0;

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

  async bytes(path: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(path);
    } catch {
      return undefined;
    }
  },

  async stat(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
    try {
      const { size, mtimeMs } = await stat(path);
      return { size, mtimeMs };
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

  /**
   * Через временный файл и переименование: вотчер и читатель не увидят файл наполовину — правка
   * карты пишет `_index.json`, который модель следом перечитывает.
   */
  async write(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    temp += 1;
    const draft = `${path}.${process.pid}-${temp}.tmp`;
    await writeFile(draft, text, "utf8");
    try {
      await rename(draft, path);
    } catch (error) {
      await rm(draft, { force: true });
      throw error;
    }
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
   * За чем следить, вправе сказать зовущий — решение 0023: имена сверяются с `include` целиком.
   * Глобы сверяют у себя плагины (`files`, `shell`): их вотчеры живут в их процессе.
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
      const hit = (wanted: string) => path === wanted || path.endsWith(`/${wanted}`);
      if (include && !include.some(hit)) {
        return;
      }
      onChange(`${root}/${path}`);
    });
    return () => watcher.close();
  },
};

/**
 * Снять процесс плагина вместе с детьми: команды и агента экшонов запускают плагины `shell` и
 * `agent`, и процесс плагина уходит не один. На Windows дерево снимает `taskkill /T`; на
 * остальных — сам процесс.
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

/**
 * Процесс плагина — node, который запустил cli: ставить свой проекту не нужно. stdout — строки
 * протокола, stderr — лог плагина.
 */
function startPlugin(params: { script: string; cwd: string; env: ProcessEnv }): PluginProcess {
  const child = spawn(process.execPath, [params.script], {
    cwd: params.cwd,
    env: params.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const lines: ((line: string) => void)[] = [];
  let buffer = "";
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let at = buffer.indexOf("\n");
    while (at !== -1) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line) for (const listener of lines) listener(line);
      at = buffer.indexOf("\n");
    }
  });
  // Процесс, который не запустился, тоже «вышел»: ждущие должны узнать, а не висеть.
  const exits: ((code: number | null) => void)[] = [];
  let exited = false;
  const exit = (code: number | null) => {
    if (exited) return;
    exited = true;
    for (const listener of exits) listener(code);
  };
  child.on("exit", (code) => exit(code));
  child.on("error", () => exit(null));
  child.stdin.on("error", () => {});
  return {
    send: (line) => {
      if (!exited) child.stdin.write(line);
    },
    onLine: (listener) => lines.push(listener),
    onLog: (listener) => child.stderr.on("data", (chunk: string) => listener(chunk)),
    onExit: (listener) => exits.push(listener),
    kill: () => killTree(child),
  };
}

/**
 * Зависимости плагина — `npm` в его папке, командой платформы (`PLUGIN_INSTALL`). На Windows npm —
 * это `npm.cmd`, а `.cmd` node запускает только через оболочку; аргументы — постоянные строки.
 * Отказ — с хвостом вывода npm: по нему платформа узнаёт, что сети нет.
 */
export function installPackages(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(PLUGIN_INSTALL.command, [...PLUGIN_INSTALL.args], {
      cwd: dir,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) =>
      reject(new Error(`npm не запустился: ${error.message} — стоит ли node с npm?`)),
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install вышел с кодом ${code}: ${output.trim()}`));
    });
  });
}

/**
 * Доверенные плагины — у пользователя, а не в репозитории: `~/.mapward/trust.json`, карта и путь
 * плагина. Спросить в терминале некого, поэтому чужой плагин cli не запускает — подтверждают его
 * в редакторе; записывает cli только встроенный, который скопировал сам.
 */
export const TRUST_FILE = join(homedir(), ".mapward", "trust.json");

/**
 * Путь в файле доверия: прямые слэши и строчная буква диска. Редактор отдаёт `d:/…`, терминал —
 * `D:/…`, а на Windows это один путь: без этого «да» из редактора cli не находил.
 */
const slash = (path: string) =>
  path.replaceAll("\\", "/").replace(/^[A-Z]:/, (drive) => drive.toLowerCase());

/** Записи, сделанные до нормализации, сводятся к ней же при чтении. */
export async function trustedPlugins(): Promise<Record<string, string[]>> {
  let raw: Record<string, string[]>;
  try {
    raw = JSON.parse(await readFile(TRUST_FILE, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
  const trust: Record<string, string[]> = {};
  for (const [map, plugins] of Object.entries(raw)) {
    const key = slash(map);
    trust[key] = [...new Set([...(trust[key] ?? []), ...plugins.map(slash)])];
  }
  return trust;
}

/** Записать «да» тем же файлом, что читает редактор: доверенное в cli доверено и там. */
export async function grantPlugin(mapPath: string, plugin: string): Promise<void> {
  const trust = await trustedPlugins();
  const map = slash(mapPath);
  trust[map] = [...new Set([...(trust[map] ?? []), slash(plugin)])];
  await mkdir(dirname(TRUST_FILE), { recursive: true });
  await writeFile(TRUST_FILE, `${JSON.stringify(trust, null, 2)}\n`, "utf8");
}

export function createPorts(): ServerPorts {
  return {
    files,

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

    plugins: { start: startPlugin },

    packages: { install: installPackages },

    trust: {
      allow: async ({ mapPath, plugin }) =>
        (await trustedPlugins())[slash(mapPath)]?.includes(slash(plugin)) ?? false,
      grant: ({ mapPath, plugin }) => grantPlugin(mapPath, plugin),
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
