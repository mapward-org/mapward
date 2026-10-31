import { debounce } from "./debounce.ts";
import type { FileSource } from "./files.ts";
import type {
  ClockPort,
  FileEntry,
  FileReader,
  FileStat,
  FileWatcher,
  TimersPort,
} from "./ports.ts";
import { sameBytes } from "./stream.ts";

const slash = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

/**
 * Что читается по пути: текст, содержимое папки, байты или размер со временем. Один путь под
 * разными видами — разные листы: каждый читается своим чтением и сравнивается по-своему.
 */
type Leaf = {
  kind: "file" | "list" | "bytes" | "stat";
  /** Путь как его назвали: им читается файл. */
  path: string;
  /** Тот же путь в одном виде — по нему сверяется то, что прислал вотчер. */
  key: string;
  loaded: boolean;
  value: unknown;
  listeners: Set<(value: unknown) => void>;
  load: () => Promise<unknown>;
};

/** Правка редактором пишет файл несколько раз подряд — изменения ждут тишины и идут пачкой. */
const QUIET_MS = 40;

/**
 * Путь в одном виде: вотчер редактора присылает обратные слэши и маленькую букву диска, а карта
 * называет свои файлы как пришлось. Сверять их как есть значило бы пропускать изменения.
 */
export const pathKey = (path: string): string =>
  slash(path).replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);

/** Байты сравниваются побайтово: через json файл развернулся бы в объект с ключом на байт. */
const same = (kind: Leaf["kind"], a: unknown, b: unknown) =>
  kind === "bytes" ? sameBytes(a, b) : a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Файлы с диска — источник для `LiveFiles` (решение 0041). Файл читается, когда на него
 * подписались, и держится, пока подписан хоть кто-то: все читатели читают одно и то же, а не
 * каждый своё. Диск — порты: сервер даёт свои, плагин — `createVfs` из `@mapward/plugin`.
 *
 * Вотчер один на корень и стоит, пока читается хоть один файл: следить за тем, что никто не
 * держит, незачем — следующее чтение и так пойдёт на диск. Изменения от него собираются в пачку
 * по тишине: изменившиеся файлы и папки над ними перечитываются разом, а подписчики получают
 * только то, что правда поменялось.
 */
export class DiskFiles implements FileSource {
  private readonly leaves = new Map<string, Leaf>();
  private readonly pending = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private readonly quiet: { tick: () => void };
  private stopWatch: (() => void) | undefined;

  constructor(
    readonly root: string,
    private readonly reader: FileReader,
    private readonly watcher: FileWatcher,
    timers: TimersPort,
    clock: ClockPort,
  ) {
    this.quiet = debounce(timers, clock, QUIET_MS, () => void this.flush());
  }

  /** Лежит ли путь под корнем: сервер так решает, читать ли файл по мосту. */
  holds(path: string): boolean {
    const key = pathKey(path);
    const root = pathKey(this.root);
    return key === root || key.startsWith(`${root}/`);
  }

  file(path: string, next: (text: string | undefined) => void): () => void {
    return this.subscribe("file", path, () => this.reader.read(path), next as (v: unknown) => void);
  }

  list(path: string, next: (entries: FileEntry[]) => void): () => void {
    return this.subscribe("list", path, () => this.reader.list(path), next as (v: unknown) => void);
  }

  /** Байты файла; хост, который так не читает, отвечает `undefined`. */
  bytes(path: string, next: (bytes: Uint8Array | undefined) => void): () => void {
    return this.subscribe(
      "bytes",
      path,
      async () => this.reader.bytes?.(path),
      next as (v: unknown) => void,
    );
  }

  /** Размер и время изменения; хост, который не умеет, отвечает `undefined`. */
  stat(path: string, next: (stat: FileStat | undefined) => void): () => void {
    return this.subscribe(
      "stat",
      path,
      async () => this.reader.stat?.(path),
      next as (v: unknown) => void,
    );
  }

  /**
   * Эти пути изменились — перечитать их и разослать. Так приходят свои записи: ждать вотчера им
   * незачем, а тот, кто записал, следом читает и должен видеть своё.
   */
  touch(paths: string[]): Promise<void> {
    for (const path of paths) {
      const key = pathKey(path);
      this.pending.add(key);
      // Перенесённая или удалённая папка (решение 0044): её файлы, которые кто-то читает,
      // перечитываются тоже — иначе читатель держал бы их содержимое по старому пути.
      for (const leaf of this.leaves.values()) {
        if (leaf.key.startsWith(`${key}/`)) this.pending.add(leaf.key);
      }
    }
    return this.flush();
  }

  /** Перечитать всё, что сейчас читается, — кнопка «перечитать карту» (решение 0041). */
  reload(): Promise<void> {
    for (const leaf of this.leaves.values()) this.pending.add(leaf.key);
    return this.flush();
  }

  dispose(): void {
    this.unwatch();
  }

  private unwatch(): void {
    this.stopWatch?.();
    this.stopWatch = undefined;
  }

  private subscribe(
    kind: Leaf["kind"],
    path: string,
    load: () => Promise<unknown>,
    next: (value: unknown) => void,
  ): () => void {
    const id = `${kind}:${pathKey(path)}`;
    // Вотчер встаёт до первого чтения: правка, пришедшая, пока файл читается, не теряется.
    this.stopWatch ??= this.watcher.watch(this.root, (changed) => {
      this.pending.add(pathKey(changed));
      this.quiet.tick();
    });
    let leaf = this.leaves.get(id);
    if (!leaf) {
      const created: Leaf = {
        kind,
        path,
        key: pathKey(path),
        loaded: false,
        value: undefined,
        listeners: new Set(),
        load: () => load().catch(() => (kind === "list" ? [] : undefined)),
      };
      this.leaves.set(id, created);
      void created.load().then((value) => {
        // Пока читали, могла пройти пачка: у неё значение свежее, затирать его нечем.
        if (created.loaded) return;
        created.loaded = true;
        created.value = value;
        for (const listener of created.listeners) listener(value);
      });
      leaf = created;
    }
    const held = leaf;
    held.listeners.add(next);
    if (held.loaded) next(held.value);

    return () => {
      held.listeners.delete(next);
      if (held.listeners.size === 0 && this.leaves.get(id) === held) this.leaves.delete(id);
      if (this.leaves.size === 0) this.unwatch();
    };
  }

  /** Пачки идут по очереди: вторая, пришедшая во время первой, ждёт её конца. */
  private flush(): Promise<void> {
    const next = this.queue.then(() => this.apply());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async apply(): Promise<void> {
    if (this.pending.size === 0) return;
    const changed = [...this.pending];
    this.pending.clear();

    // Папку перечитываем, когда изменилось что-то под ней: так видно новый и пропавший файл и
    // новый размер. Размер со временем — так же: у папки он меняется от её содержимого.
    // Одинаковое содержимое дальше не уходит.
    const hit = (leaf: Leaf) =>
      leaf.kind === "file" || leaf.kind === "bytes"
        ? changed.includes(leaf.key)
        : changed.some((path) => path === leaf.key || path.startsWith(`${leaf.key}/`));
    const affected = [...this.leaves.values()].filter(hit);
    const values = await Promise.all(affected.map((leaf) => leaf.load()));

    for (const [index, leaf] of affected.entries()) {
      const value = values[index];
      if (leaf.loaded && same(leaf.kind, leaf.value, value)) continue;
      leaf.loaded = true;
      leaf.value = value;
      for (const listener of leaf.listeners) listener(value);
    }
  }
}
