import { Observable, map, of, startWith } from "rxjs";
import type { FileEntry, FileStat } from "./ports.ts";
import { cached, PENDING, sameBytes, type Maybe } from "./stream.ts";

/**
 * Откуда `LiveFiles` берут файлы: диск с вотчером (`DiskFiles`) или что угодно в тестах. Подписка отдаёт первое
 * содержимое и дальше каждое изменение; отписка — файл больше никому не нужен.
 */
export type FileSource = {
  /** Содержимое файла; файла нет — `undefined`. */
  file(path: string, next: (text: string | undefined) => void): () => void;
  /** Содержимое папки; папки нет — пусто. */
  list(path: string, next: (entries: FileEntry[]) => void): () => void;
  /**
   * Содержимое байтами; файла нет — `undefined`. Источник, который не умеет (источник в памяти
   * у тестов текста), его не даёт: поток тогда отвечает `undefined`.
   */
  bytes?(path: string, next: (bytes: Uint8Array | undefined) => void): () => void;
  /** Размер и время изменения без чтения; файла нет — `undefined`. Необязателен, как `bytes`. */
  stat?(path: string, next: (stat: FileStat | undefined) => void): () => void;
};

/**
 * Файлы потоками: каждый файл и папка — свой поток, один на путь, сколько бы его ни читали.
 * Читается, когда на него подписались, и отпускается, когда подписчиков не осталось. Пока
 * содержимое не пришло, поток говорит `PENDING`.
 */
export class LiveFiles {
  private readonly files = new Map<string, Observable<Maybe<string | undefined>>>();
  private readonly folders = new Map<string, Observable<Maybe<FileEntry[]>>>();
  private readonly blobs = new Map<string, Observable<Maybe<Uint8Array | undefined>>>();
  private readonly stats = new Map<string, Observable<Maybe<FileStat | undefined>>>();
  private readonly parsed = new Map<string, Observable<Maybe<unknown>>>();

  /**
   * `keep` — сколько файл и папка держатся прочитанными после ухода последнего подписчика (см.
   * `cached`; срок по таймеру среды — `keepFor`). Держатся только они, а не то, что над ними
   * строят: дорого здесь чтение диска, а сборку из прочитанного граф повторит быстро. Держи
   * верхние слои — отпускались бы они ступенька за ступенькой, по сроку на каждую.
   */
  constructor(
    private readonly source: FileSource,
    private readonly keep?: () => Observable<unknown>,
  ) {}

  /** Текст файла; `undefined` — файла нет. */
  text$(path: string): Observable<Maybe<string | undefined>> {
    return cached(
      this.files,
      path,
      () =>
        new Observable<string | undefined>((subscriber) =>
          this.source.file(path, (text) => subscriber.next(text)),
        ).pipe(startWith<Maybe<string | undefined>>(PENDING)),
      undefined,
      this.keep,
    );
  }

  /** Содержимое папки. */
  list$(path: string): Observable<Maybe<FileEntry[]>> {
    return cached(
      this.folders,
      path,
      () =>
        new Observable<FileEntry[]>((subscriber) =>
          this.source.list(path, (entries) => subscriber.next(entries)),
        ).pipe(startWith<Maybe<FileEntry[]>>(PENDING)),
      undefined,
      this.keep,
    );
  }

  /**
   * Файл байтами — то, что текстом испортится: картинка, архив, индекс git. `undefined` — файла
   * нет. Одинаковое по байтам содержимое дальше не уходит.
   */
  bytes$(path: string): Observable<Maybe<Uint8Array | undefined>> {
    const { source } = this;
    return cached(
      this.blobs,
      path,
      () =>
        source.bytes
          ? new Observable<Uint8Array | undefined>((subscriber) =>
              source.bytes!(path, (bytes) => subscriber.next(bytes)),
            ).pipe(startWith<Maybe<Uint8Array | undefined>>(PENDING))
          : of(undefined),
      sameBytes,
      this.keep,
    );
  }

  /**
   * Размер и время изменения файла, не читая его: дешёвый сигнал «изменился», когда содержимое
   * не нужно, — так плагин `files` следит за индексом git. `undefined` — файла нет.
   */
  stat$(path: string): Observable<Maybe<FileStat | undefined>> {
    const { source } = this;
    return cached(
      this.stats,
      path,
      () =>
        source.stat
          ? new Observable<FileStat | undefined>((subscriber) =>
              source.stat!(path, (stat) => subscriber.next(stat)),
            ).pipe(startWith<Maybe<FileStat | undefined>>(PENDING))
          : of(undefined),
      undefined,
      this.keep,
    );
  }

  /** Файл как json; не json или файла нет — `undefined`. */
  json$(path: string): Observable<Maybe<unknown>> {
    return cached(this.parsed, path, () =>
      this.text$(path).pipe(
        map((text) => {
          if (text === PENDING) return PENDING;
          if (text === undefined) return undefined;
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return undefined;
          }
        }),
      ),
    );
  }
}
