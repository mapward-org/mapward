import {
  combineLatest,
  defer,
  distinctUntilChanged,
  filter,
  map,
  Observable,
  of,
  share,
  ReplaySubject,
  startWith,
  switchMap,
  type OperatorFunction,
} from "rxjs";

/**
 * Кирпичи живой модели на потоках. Модель карты — граф наблюдаемых: файл, свой индекс объекта,
 * собранный, с подстановками, снимок. Здесь то, без чего этот граф течёт: пометка «ещё читается»,
 * общий поток на ключ и одна выдача на пачку изменений.
 */

/** Значение ещё не пришло. Не то же, что «пусто»: о пустоте источник говорит сам. */
export const PENDING: unique symbol = Symbol("pending");
export type Pending = typeof PENDING;
export type Maybe<T> = T | Pending;

export const isReady = <T>(value: Maybe<T>): value is T => value !== PENDING;

/** Одинаковое по содержимому дальше не уходит: неизменённая ветка карты не пересобирается. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Одинаковое по байтам — побайтово, длина сперва: `sameJson` развернул бы файл в объект с ключом
 * на каждый байт. Не байты (`undefined`, `PENDING`) сравниваются как есть.
 */
export function sameBytes(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * Зависимость, которая узнаётся из данных: `extends`, папка, цель подстановки. Пока новая
 * зависимость не ответила, вниз идёт `PENDING`, а не прежнее значение вперемешку с новым: иначе
 * объект на миг собирался бы из нового индекса и старого прототипа.
 */
export function follow<A, B>(
  next: (value: A) => Observable<Maybe<B>>,
): OperatorFunction<Maybe<A>, Maybe<B>> {
  return switchMap((value) =>
    isReady(value) ? next(value).pipe(startWith<Maybe<B>>(PENDING)) : of<Maybe<B>>(PENDING),
  );
}

/** Значение каждой части, когда готовы все; пока хоть одна читается — `PENDING`. */
export function every<T>(parts: Observable<Maybe<T>>[]): Observable<Maybe<T[]>> {
  if (parts.length === 0) return of([]);
  return combineLatest(parts).pipe(
    map((values) => (values.every(isReady) ? (values as T[]) : PENDING)),
  );
}

/** Готовое значение, преобразованное; `PENDING` проходит как есть. */
export function mapReady<A, B>(project: (value: A) => B): OperatorFunction<Maybe<A>, Maybe<B>> {
  return map((value) => (isReady(value) ? project(value) : PENDING));
}

/**
 * Один поток на ключ: подписчиков сколько угодно, источник один. Последнее значение отдаётся
 * новому подписчику сразу, а одинаковое дальше не уходит. Последний подписчик ушёл — источник
 * отпускается, и в следующий раз читается заново: без подписки значение могло протухнуть молча.
 *
 * `keep` — сколько держать источник после ухода последнего подписчика: поток, по первому
 * значению которого он отпускается. Таймеров среды у пакета нет, поэтому срок приносит тот, кто
 * знает, где запущен; не принёс — отпускается сразу. Пока держится, источник слушает изменения,
 * так что вернувшийся подписчик получает свежее, а не запомненное.
 */
export function cached<T>(
  cache: Map<string, Observable<T>>,
  key: string,
  make: () => Observable<T>,
  equals: (a: T, b: T) => boolean = sameJson,
  keep?: () => Observable<unknown>,
): Observable<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const created = make().pipe(
    stable(equals),
    share({
      connector: () => new ReplaySubject<T>(1),
      resetOnError: true,
      resetOnComplete: false,
      resetOnRefCountZero: keep ?? true,
    }),
  );
  cache.set(key, created);
  return created;
}

/**
 * Тождество сквозь `PENDING`. Пока зависимость перечитывается, вниз идёт `PENDING`, а потом то же
 * значение заново — новым объектом. Сравнение с последним готовым возвращает прежний объект: тогда
 * ветка, которую перечитали без изменений, приходит наверх тем же объектом и ничего не пересобирает.
 */
export function stable<T>(equals: (a: T, b: T) => boolean = sameJson): OperatorFunction<T, T> {
  return (source) =>
    defer(() => {
      let last: { value: T } | undefined;
      return source.pipe(
        map((value) => {
          if (!isReady(value)) return value;
          if (last && equals(last.value, value)) return last.value;
          last = { value };
          return value;
        }),
        distinctUntilChanged(),
      );
    });
}

/**
 * Одна выдача на пачку. Пачку изменений вотчер раскладывает синхронно, файл за файлом, и граф
 * успевает выдать промежуточное состояние на каждом. Наружу уходит последнее за такт, и только
 * готовое: подписчик видит карту до пачки и после неё, но не посередине.
 */
export function settle<T>(
  equals: (a: T, b: T) => boolean = sameJson,
): OperatorFunction<Maybe<T>, T> {
  return (source) =>
    new Observable<T>((subscriber) => {
      let latest: Maybe<T> = PENDING;
      let scheduled = false;
      let last: { value: T } | undefined;
      const flush = () => {
        scheduled = false;
        if (!isReady(latest)) return;
        if (last && equals(last.value, latest)) return;
        last = { value: latest };
        subscriber.next(latest);
      };
      const subscription = source.subscribe({
        next: (value) => {
          latest = value;
          if (scheduled) return;
          scheduled = true;
          queueTask(flush);
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => {
          flush();
          subscriber.complete();
        },
      });
      return () => subscription.unsubscribe();
    });
}

/** Микрозадача без типов среды: у пакета их нет, он не знает, где запущен. */
const queueTask = (run: () => void) => {
  void Promise.resolve().then(run);
};

/** Только готовые значения — для тех, кому промежуточное не нужно вовсе. */
export const ready = <T>(): OperatorFunction<Maybe<T>, T> => filter(isReady);
