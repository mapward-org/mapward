import { observable, onBecomeObserved, onBecomeUnobserved, runInAction } from "mobx";
import type { IObservableValue } from "mobx";
import type { FolderEntry } from "../model/raw-object.ts";

/**
 * Откуда живая модель берёт файлы — решение 0041. На сервере это диск с вотчером, на клиенте
 * мост. Подписка отдаёт первое содержимое и дальше каждое изменение; отписка — файл больше
 * никому не нужен. Звать `next` можно когда угодно, в том числе сразу: модель сама отложит
 * запись до конца текущего такта и положит всё пришедшее за такт одной пачкой.
 */
export type FileSource = {
  /** Содержимое файла; файла нет — `undefined`. */
  file(path: string, next: (text: string | undefined) => void): () => void;
  /** Содержимое папки; папки нет — пусто. */
  list(path: string, next: (entries: FolderEntry[]) => void): () => void;
};

/** Значение ещё не пришло. Не то же, что «файла нет»: об отсутствии источник говорит сам. */
export const PENDING: unique symbol = Symbol("pending");
export type Pending = typeof PENDING;

type Cell<T> = {
  box: IObservableValue<T | Pending>;
  stop?: () => void;
};

/**
 * Файлы карты наблюдаемыми значениями. Ячейка заводится, когда её впервые прочитали, читается
 * источником, когда у неё появился наблюдатель, и отпускается, когда наблюдателей не осталось —
 * это и есть стор, который делает запрос при подписке.
 *
 * Пришедшее от источника копится до конца такта и кладётся одним действием: несколько файлов,
 * изменившихся разом, дают одну пересборку, и промежуточную карту никто не видит.
 */
export class LiveFiles {
  private readonly cells = new Map<string, Cell<unknown>>();
  private queue: (() => void)[] = [];
  private scheduled = false;

  constructor(private readonly source: FileSource) {}

  /** Текст файла, `undefined` — файла нет, `PENDING` — ещё не пришёл. */
  text(path: string): string | undefined | Pending {
    return this.cell<string | undefined>("file", path, (next) => this.source.file(path, next));
  }

  /** Содержимое папки, `PENDING` — ещё не пришло. */
  list(path: string): FolderEntry[] | Pending {
    return this.cell<FolderEntry[]>("list", path, (next) => this.source.list(path, next));
  }

  private cell<T>(
    kind: "file" | "list",
    path: string,
    subscribe: (next: (value: T) => void) => () => void,
  ): T | Pending {
    const key = `${kind}:${path}`;
    let cell = this.cells.get(key) as Cell<T> | undefined;
    if (!cell) {
      const created: Cell<T> = {
        // Сравнение по значению: одинаковый ответ источника дальше не уходит.
        box: observable.box<T | Pending>(PENDING, { deep: false, equals: sameValue }),
      };
      onBecomeObserved(created.box, () => {
        created.stop = subscribe((value) => this.later(() => created.box.set(value)));
      });
      onBecomeUnobserved(created.box, () => {
        created.stop?.();
        created.stop = undefined;
        // Забытое прочитается заново: без наблюдателя оно могло протухнуть молча.
        this.later(() => created.box.set(PENDING));
        this.cells.delete(key);
      });
      this.cells.set(key, created as Cell<unknown>);
      cell = created;
    }
    return cell.box.get();
  }

  /** Запись — после такта и пачкой: источник мог позвать `next` посреди чужого вычисления. */
  private later(write: () => void): void {
    this.queue.push(write);
    if (this.scheduled) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {
      const writes = this.queue;
      this.queue = [];
      this.scheduled = false;
      runInAction(() => {
        for (const run of writes) run();
      });
    });
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
