import { BehaviorSubject, distinctUntilChanged, filter, map, Observable, Subject } from "rxjs";
import type {
  ClockPort,
  FileEntry,
  FileReader,
  FileWatcher,
  TimersPort,
} from "../../../../ports/index.ts";
import { debounce } from "../../../../lib/debounce.ts";
import { slash } from "../../../../lib/path.ts";

const LOADING = Symbol("loading");

type Leaf = {
  kind: "file" | "list";
  /** Путь как его назвали: им читается файл. */
  path: string;
  /** Тот же путь в одном виде — по нему сверяется то, что прислал вотчер. */
  key: string;
  subject: BehaviorSubject<unknown>;
  load: () => Promise<unknown>;
  refs: number;
};

/** Правка редактором пишет файл несколько раз подряд — изменения ждут тишины и идут пачкой. */
const QUIET_MS = 40;

/**
 * Путь в одном виде: вотчер редактора присылает обратные слэши и маленькую букву диска, а карта
 * называет свои файлы как пришлось. Сверять их как есть значило бы пропускать изменения.
 */
export const pathKey = (path: string): string =>
  slash(path).replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Файлы карты потоками — низ реактивной модели (решение 0041).
 *
 * Асинхронное живёт только здесь: файл сначала читается, и только готовое содержимое кладётся в
 * его поток. Всё, что строится выше, считается синхронно. Поток заводится, когда на файл
 * сослались, и гаснет, когда ссылаться перестали; тот, кто подписывается снова в том же такте —
 * так переподписывается `switchMap`, — получает уже прочитанное, а не читает заново.
 *
 * Изменения от вотчера собираются в пачку и кладутся целиком: промежуточные сборки выше
 * возникают только внутри одного синхронного прохода, а конец прохода объявляет `flushed$`.
 */
export class FileStore {
  /** Пачка изменений разложена по потокам: выше можно отдавать собранное. */
  readonly flushed$ = new Subject<void>();
  /** Идёт синхронный проход пачки — отдавать собранное рано, оно может быть наполовину старым. */
  flushing = false;

  private readonly leaves = new Map<string, Leaf>();
  private readonly pending = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  /** Сколько чтений идёт — первых и пачечных; пока их больше нуля, модель ещё не догнала диск. */
  private inflight = 0;
  private waiters: (() => void)[] = [];
  private readonly quiet: { tick: () => void };
  private readonly stopWatch: () => void;

  constructor(
    root: string,
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

  /** Содержимое файла; файла нет — `undefined`. */
  file(path: string): Observable<string | undefined> {
    return this.leaf("file", path, () => this.reader.read(path)) as Observable<string | undefined>;
  }

  /** Разобранный json; не json или файла нет — `undefined`. */
  json(path: string): Observable<unknown> {
    return this.file(path).pipe(map(parseJson));
  }

  /** Содержимое папки; папки нет — пусто. */
  list(path: string): Observable<FileEntry[]> {
    return this.leaf("list", path, () => this.reader.list(path)) as Observable<FileEntry[]>;
  }

  /**
   * Эти пути изменились — перечитать их и отдать пачкой. Так приходят свои записи сервера:
   * ждать вотчера им незачем, а тот, кто записал, следом читает карту и должен видеть своё.
   */
  async touch(paths: string[]): Promise<void> {
    for (const path of paths) this.pending.add(pathKey(path));
    await this.flush();
    await this.idle();
  }

  /** Перечитать всё, что сейчас читается, — кнопка «перечитать» (решение 0041). */
  async reload(): Promise<void> {
    for (const leaf of this.leaves.values()) this.pending.add(leaf.key);
    await this.flush();
    await this.idle();
  }

  /**
   * Все начатые чтения кончились. Пачка заводит новые — у нового объекта свои файлы, — и они
   * идут уже после неё; тот, кто хочет видеть карту целиком, ждёт и их.
   */
  idle(): Promise<void> {
    if (this.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  dispose(): void {
    this.stopWatch();
  }

  private leaf(
    kind: Leaf["kind"],
    path: string,
    load: () => Promise<unknown>,
  ): Observable<unknown> {
    const id = `${kind}:${pathKey(path)}`;
    const same = kind === "file" ? Object.is : sameJson;

    return new Observable((subscriber) => {
      let leaf = this.leaves.get(id);
      if (!leaf) {
        const created: Leaf = {
          kind,
          path,
          key: pathKey(path),
          subject: new BehaviorSubject<unknown>(LOADING),
          load: () => load().catch(() => (kind === "list" ? [] : undefined)),
          refs: 0,
        };
        this.leaves.set(id, created);
        this.inflight += 1;
        void created
          .load()
          .then((value) => {
            // Пока читали, могла пройти пачка: у неё значение свежее, затирать его нечем.
            if (created.subject.value === LOADING) created.subject.next(value);
          })
          .finally(() => this.settle());
        leaf = created;
      }
      const held = leaf;
      held.refs += 1;

      const subscription = held.subject
        .pipe(
          filter((value) => value !== LOADING),
          distinctUntilChanged(same),
        )
        .subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        held.refs -= 1;
        if (held.refs > 0) return;
        // Гаснет не сразу: `switchMap` отписывается от старого раньше, чем подписывается на
        // новое, и прочитанное иначе терялось бы на каждой переподписке.
        void Promise.resolve().then(() => {
          if (held.refs === 0 && this.leaves.get(id) === held) this.leaves.delete(id);
        });
      };
    });
  }

  /** Пачки идут по очереди: вторая, пришедшая во время первой, ждёт её конца. */
  private flush(): Promise<void> {
    this.inflight += 1;
    const next = this.queue.then(() => this.apply()).finally(() => this.settle());
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Чтение кончилось. Последнее будит тех, кто ждёт карту целиком. */
  private settle(): void {
    this.inflight -= 1;
    if (this.inflight > 0) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
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

    this.flushing = true;
    try {
      for (const [index, leaf] of affected.entries()) leaf.subject.next(values[index]);
    } finally {
      this.flushing = false;
    }
    this.flushed$.next();
  }
}

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
