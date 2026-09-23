import type { FileSource, FolderEntry } from "@mapward/core";
import type { ClockPort, FileReader, FileWatcher, TimersPort } from "../../../../ports/index.ts";
import { debounce } from "../../../../lib/debounce.ts";
import { slash } from "../../../../lib/path.ts";

type Leaf = {
  kind: "file" | "list";
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

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Файлы карты с диска — источник живой модели на сервере (решение 0041). Файл читается, когда
 * на него подписались, и держится, пока подписан хоть кто-то: модель сервера и клиенты через
 * мост читают одно и то же, а не каждый своё.
 *
 * Вотчер один на карту. Изменения от него собираются в пачку по тишине: изменившиеся файлы и
 * папки над ними перечитываются разом, а подписчики получают только то, что правда поменялось.
 */
export class DiskFiles implements FileSource {
  private readonly leaves = new Map<string, Leaf>();
  private readonly pending = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private readonly quiet: { tick: () => void };
  private readonly stopWatch: () => void;

  constructor(
    readonly root: string,
    private readonly reader: FileReader,
    watcher: FileWatcher,
    timers: TimersPort,
    clock: ClockPort,
  ) {
    this.quiet = debounce(timers, clock, QUIET_MS, () => void this.flush());
    this.stopWatch = watcher.watch(root, (path) => {
      this.pending.add(pathKey(path));
      this.quiet.tick();
    });
  }

  /** Лежит ли путь внутри карты: мост читает только её. */
  holds(path: string): boolean {
    const key = pathKey(path);
    const root = pathKey(this.root);
    return key === root || key.startsWith(`${root}/`);
  }

  file(path: string, next: (text: string | undefined) => void): () => void {
    return this.subscribe("file", path, () => this.reader.read(path), next as (v: unknown) => void);
  }

  list(path: string, next: (entries: FolderEntry[]) => void): () => void {
    return this.subscribe("list", path, () => this.reader.list(path), next as (v: unknown) => void);
  }

  /**
   * Эти пути изменились — перечитать их и разослать. Так приходят свои записи сервера: ждать
   * вотчера им незачем, а тот, кто записал, следом читает карту и должен видеть своё.
   */
  touch(paths: string[]): Promise<void> {
    for (const path of paths) this.pending.add(pathKey(path));
    return this.flush();
  }

  /** Перечитать всё, что сейчас читается, — кнопка «перечитать» (решение 0041). */
  reload(): Promise<void> {
    for (const leaf of this.leaves.values()) this.pending.add(leaf.key);
    return this.flush();
  }

  dispose(): void {
    this.stopWatch();
  }

  private subscribe(
    kind: Leaf["kind"],
    path: string,
    load: () => Promise<unknown>,
    next: (value: unknown) => void,
  ): () => void {
    const id = `${kind}:${pathKey(path)}`;
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

    // Папку перечитываем, когда изменилось что-то под ней: так видно новый и пропавший объект, а
    // у директивы — её новый размер. Одинаковое содержимое дальше не уходит.
    const hit = (leaf: Leaf) =>
      leaf.kind === "file"
        ? changed.includes(leaf.key)
        : changed.some((path) => path === leaf.key || path.startsWith(`${leaf.key}/`));
    const affected = [...this.leaves.values()].filter(hit);
    const values = await Promise.all(affected.map((leaf) => leaf.load()));

    for (const [index, leaf] of affected.entries()) {
      const value = values[index];
      if (leaf.loaded && same(leaf.value, value)) continue;
      leaf.loaded = true;
      leaf.value = value;
      for (const listener of leaf.listeners) listener(value);
    }
  }
}
