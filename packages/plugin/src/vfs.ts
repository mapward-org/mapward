import {
  DiskFiles,
  keepFor,
  LiveFiles,
  type ClockPort,
  type FileEntry,
  type FileReader,
  type FileWatcher,
  type TimersPort,
} from "@mapward/vfs";

/**
 * Файлы папки потоками для плагина — `@mapward/vfs` поверх node: тот же механизм, которым
 * платформа держит карту. Файл и папка читаются, когда на них подписались, и отпускаются без
 * подписчиков; вотчер один на папку и стоит, пока читается хоть что-то; правка, записанная
 * несколькими заходами, приходит одним изменением.
 *
 * ```ts
 * const vfs = createVfs(ctx.pluginDir, { keep: 30_000 });
 * return vfs.json$(`${ctx.pluginDir}/settings.json`);
 * ```
 */
export type Vfs = LiveFiles & {
  /** Эти пути изменились — перечитать сразу, не дожидаясь вотчера: так приходят свои записи. */
  touch(paths: string[]): Promise<void>;
  /** Перечитать всё, что сейчас читается. */
  reload(): Promise<void>;
  /** Снять вотчер. Обычно не нужно: он снимается сам, когда читать стало некому. */
  dispose(): void;
};

export type VfsOptions = {
  /** Сколько миллисекунд держать файл прочитанным после ухода последнего читателя. */
  keep?: number;
};

/**
 * Модули node берутся у процесса, а не импортом: пакет собирается без типов node и не знает,
 * где запущен (`tests/platform-independence.test.ts`) — как `startStdio` берёт `process`. Плагин
 * же всегда живёт в node платформы, и `getBuiltinModule` там есть (node ≥ 22).
 */
type Dirent = { name: string; isDirectory(): boolean };
type Watcher = { close(): void; on(event: "error", listener: () => void): void };
type Node = {
  readFile: {
    (path: string, encoding: "utf8"): Promise<string>;
    (path: string): Promise<Uint8Array>;
  };
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  watch(
    path: string,
    options: { recursive: boolean },
    listener: (event: string, name: string | null) => void,
  ): Watcher;
};

function node(): Node {
  const { process } = globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  };
  const promises = process.getBuiltinModule("node:fs/promises") as Pick<
    Node,
    "readFile" | "readdir" | "stat"
  >;
  const fs = process.getBuiltinModule("node:fs") as Pick<Node, "watch">;
  return {
    readFile: promises.readFile,
    readdir: promises.readdir,
    stat: promises.stat,
    watch: fs.watch,
  };
}

const slash = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

/** Порты `@mapward/vfs` на node. Папки нет — пусто, вотчер её не ждёт и процесс не роняет. */
export function nodePorts(): {
  reader: FileReader;
  watcher: FileWatcher;
  timers: TimersPort;
  clock: ClockPort;
} {
  const fs = node();
  const { setTimeout, clearTimeout } = globalThis as unknown as {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
  };
  return {
    reader: {
      read: (path) => fs.readFile(path, "utf8").catch(() => undefined),
      // Без кодировки node отдаёт `Buffer` — он и есть `Uint8Array`, копировать незачем.
      bytes: (path) => fs.readFile(path).catch(() => undefined),
      stat: (path) =>
        fs.stat(path).then(
          ({ size, mtimeMs }) => ({ size, mtimeMs }),
          () => undefined,
        ),
      list: async (path): Promise<FileEntry[]> =>
        (await fs.readdir(path, { withFileTypes: true }).catch(() => [])).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        })),
    },
    watcher: {
      watch(root, onChange) {
        try {
          const watcher = fs.watch(root, { recursive: true }, (_event, name) =>
            onChange(name === null ? slash(root) : `${slash(root)}/${slash(name)}`),
          );
          watcher.on("error", () => watcher.close());
          return () => watcher.close();
        } catch {
          return () => undefined;
        }
      },
    },
    timers: {
      after(ms, run) {
        const id = setTimeout(run, ms);
        return () => clearTimeout(id);
      },
    },
    clock: { now: () => new Date().toISOString() },
  };
}

/** Файлы папки `root` потоками: `text$`, `list$`, `json$`, `bytes$`, `stat$` и `touch`/`reload`. */
export function createVfs(root: string, options: VfsOptions = {}): Vfs {
  const { reader, watcher, timers, clock } = nodePorts();
  const disk = new DiskFiles(slash(root), reader, watcher, timers, clock);
  const files = new LiveFiles(
    disk,
    options.keep === undefined ? undefined : keepFor(timers, options.keep),
  );
  return Object.assign(files, {
    touch: (paths: string[]) => disk.touch(paths),
    reload: () => disk.reload(),
    dispose: () => disk.dispose(),
  });
}
