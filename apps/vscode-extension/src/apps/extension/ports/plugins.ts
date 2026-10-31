import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { PLUGIN_INSTALL } from "@mapward/abstract-server";
import type { EditorPort, PluginProcess, ProcessEnv, TrustPort } from "@mapward/abstract-server";

/**
 * Плагины в редакторе: процесс, доверие и редактор для `ctx.vscode`. Всё, что знает про
 * `vscode` и `node`, — здесь; платформа о нём не знает.
 */

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  child.kill();
}

/**
 * Процесс плагина — node самого редактора: Electron в режиме node. Ставить свой node проекту не
 * нужно, а версия у всех плагинов одна — та, на которой собрана платформа.
 */
export function startPlugin(params: {
  script: string;
  cwd: string;
  env: ProcessEnv;
}): PluginProcess {
  const child = spawn(process.execPath, [params.script], {
    cwd: params.cwd,
    env: { ...params.env, ELECTRON_RUN_AS_NODE: "1" },
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
 * Отказ — с хвостом вывода npm: по нему платформа узнаёт, что сети нет. npm — системный: node
 * редактора — Electron, и своего npm у него нет.
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

/** Ответы человека — у него, а не в репозитории: иначе чужой репозиторий приносил бы «да» с собой. */
const TRUST_FILE = join(homedir(), ".mapward", "trust.json");

/**
 * Путь в файле доверия: прямые слэши и строчная буква диска. Редактор отдаёт `d:/…`, терминал —
 * `D:/…`, а на Windows это один путь: без этого «да» из редактора cli не находил.
 */
const slash = (path: string) =>
  path.replaceAll("\\", "/").replace(/^[A-Z]:/, (drive) => drive.toLowerCase());

/** Записи, сделанные до нормализации, сводятся к ней же при чтении. */
async function readTrust(): Promise<Record<string, string[]>> {
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

/** «Да» — в тот же файл, что читает cli: доверенное в редакторе доверено и там. */
async function grant(mapPath: string, plugin: string): Promise<void> {
  const trust = await readTrust();
  const map = slash(mapPath);
  trust[map] = [...new Set([...(trust[map] ?? []), slash(plugin)])];
  await mkdir(dirname(TRUST_FILE), { recursive: true });
  await writeFile(TRUST_FILE, `${JSON.stringify(trust, null, 2)}\n`, "utf8");
}

/**
 * Доверие к плагину: на первое обращение к новому плагину — вопрос, на «да» — запись, и больше
 * не спрашиваем. Привязано к пути, а не к содержимому: иначе вопрос всплывал бы после каждой
 * правки агента. Один вопрос на плагин за раз: два вызова подряд не открывают два окна.
 */
export function createTrust(): TrustPort {
  const asking = new Map<string, Promise<boolean>>();
  return {
    async allow({ mapPath, plugin }) {
      const map = slash(mapPath);
      const path = slash(plugin);
      if ((await readTrust())[map]?.includes(path)) return true;
      const key = `${map}|${path}`;
      const pending = asking.get(key);
      if (pending) return pending;

      const question = (async () => {
        const open = "Открыть код";
        const yes = "Доверять";
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop
          const answer = await vscode.window.showWarningMessage(
            `В карте появился плагин ${path}. Это код, который запустится на вашей машине. Доверять?`,
            { modal: true },
            yes,
            open,
          );
          if (answer === open) {
            // oxlint-disable-next-line no-await-in-loop
            await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(plugin));
            continue;
          }
          if (answer !== yes) return false;
          // oxlint-disable-next-line no-await-in-loop
          await grant(map, path);
          return true;
        }
      })().finally(() => asking.delete(key));
      asking.set(key, question);
      return question;
    },
    // Встроенный плагин, который mapward скопировал сам, — без вопроса: код пришёл с инструментом.
    grant: ({ mapPath, plugin }) => grant(mapPath, plugin),
  };
}

/** Редактор для `ctx.vscode`: короткий набор и `executeCommand` ко всему остальному. */
export const editor: EditorPort = {
  async openFile(path, options) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const line = Math.max(0, (options.line ?? 1) - 1);
    const column = Math.max(0, (options.column ?? 1) - 1);
    const position = new vscode.Position(line, column);
    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(position, position),
    });
  },
  async reveal(path) {
    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(path));
  },
  async showMessage(text, level) {
    if (level === "error") await vscode.window.showErrorMessage(text);
    else if (level === "warning") await vscode.window.showWarningMessage(text);
    else await vscode.window.showInformationMessage(text);
  },
  async terminal(command, options) {
    const terminal = vscode.window.createTerminal({
      name: options.name ?? "mapward",
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    terminal.show();
    terminal.sendText(command);
  },
  executeCommand: async (command, args) => vscode.commands.executeCommand(command, ...args),
};
