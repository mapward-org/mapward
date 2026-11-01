import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import type { FileEntry, ServerPorts } from "@mapward/abstract-server";
import { isDirectivePath } from "@/features/directive-layout/index.extension.ts";
import { createTrust, editor, installPackages, startPlugin } from "./plugins.ts";
import { changedSpan } from "./changed-span.ts";
import { marketPort } from "./market.ts";

/**
 * Реализации портов сервера для редактора — решение 0014. Всё, что знает про `vscode` и про
 * `node`, живёт здесь; сервер об этом не знает ничего.
 */

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const encode = (text: string) => new TextEncoder().encode(text);
const uri = (path: string) => vscode.Uri.file(path);

/**
 * Открытая в редакторе директива. Сервер пишет в неё статус и реплики, пока автор её правит:
 * запись мимо открытого документа дала бы конфликт с его несохранёнными правками. Поэтому
 * директиву, открытую в редакторе, читаем и пишем через документ.
 */
const openDirective = (path: string): vscode.TextDocument | undefined => {
  if (!isDirectivePath(path)) return undefined;
  const wanted = uri(path).toString();
  return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === wanted);
};

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
    const open = openDirective(path);
    if (open) return open.getText();
    try {
      return decode(await vscode.workspace.fs.readFile(uri(path)));
    } catch {
      return undefined;
    }
  },

  async bytes(path: string): Promise<Uint8Array | undefined> {
    try {
      return await vscode.workspace.fs.readFile(uri(path));
    } catch {
      return undefined;
    }
  },

  /** У `workspace.fs` время изменения — `mtime` в миллисекундах. */
  async stat(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
    try {
      const { size, mtime } = await vscode.workspace.fs.stat(uri(path));
      return { size, mtimeMs: mtime };
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
    const open = openDirective(path);
    if (open) {
      // Меняется только изменившийся кусок: замена всего текста уводила курсор и прокрутку в конец.
      const span = changedSpan(open.getText(), text);
      const edit = new vscode.WorkspaceEdit();
      if (span) {
        const range = new vscode.Range(open.positionAt(span.start), open.positionAt(span.end));
        edit.replace(open.uri, range, span.text);
      }
      // Применилось — сохраняем: диск и документ снова одно, и карта видит новый статус.
      if (await vscode.workspace.applyEdit(edit)) {
        await open.save();
        return;
      }
    }
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

  /** Перенос папки объекта — правка карты (решение 0044). Занятую цель не затирает. */
  async move(from: string, to: string): Promise<void> {
    // `createDirectory` создаёт и промежуточные папки: корзина правки заводится по пути.
    await vscode.workspace.fs.createDirectory(uri(dirname(to)));
    await vscode.workspace.fs.rename(uri(from), uri(to), { overwrite: false });
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
    // `.wasm` esbuild копируется в `dist` при сборке: в `.vsix` едет только он (решение 0037).
    bundler: { wasm: () => readFile(join(__dirname, "esbuild.wasm")) },
    // Редактор умеет всё: терминалы, открыть файл, спросить строку, показать текст без файла
    // на диске и открыть объект табом — решения 0014, 0019 и 0026.
    capabilities: { terminals: true, openFile: true, ask: true, virtualDocs: true, tabs: true },
    // Плагины: процесс на node редактора, вопрос «доверять?» и редактор для `ctx.vscode`.
    plugins: { start: startPlugin },
    // Зависимости встроенного плагина (холст `objects-map`) — npm в папке плагина.
    market: marketPort,
    packages: { install: installPackages },
    trust: createTrust(),
    editor,
  };
}
