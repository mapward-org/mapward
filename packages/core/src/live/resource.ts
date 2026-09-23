import { observable, onBecomeObserved, onBecomeUnobserved, runInAction } from "mobx";
import type { IObservableValue } from "mobx";

/**
 * Подписка источника: отдаёт значения в `next`, возвращает отписку. Звать `next` можно когда
 * угодно, в том числе сразу при подписке: ресурс сам отложит запись до конца такта.
 */
export type Subscribe<T> = (next: (value: T) => void) => () => void;

/** Значение ещё не пришло. Не то же, что «пусто»: о пустоте источник говорит сам. */
export const PENDING: unique symbol = Symbol("pending");
export type Pending = typeof PENDING;

/**
 * Записи за такт — одним действием MobX: несколько ресурсов, получивших значение разом, дают
 * одну пересборку, и промежуточного состояния никто не видит. Очередь общая на всё приложение.
 */
let queue: (() => void)[] = [];
let scheduled = false;

function later(write: () => void): void {
  queue.push(write);
  if (scheduled) return;
  scheduled = true;
  void Promise.resolve().then(() => {
    const writes = queue;
    queue = [];
    scheduled = false;
    runInAction(() => {
      for (const run of writes) run();
    });
  });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Ресурс — ленивая подписка отдельно от логики (решение 0042). Наблюдаемое значение, которое
 * подписывается на источник, когда его впервые прочитали, и отписывается, когда читателей не
 * осталось. Логики у него нет: что из значения следует, считает стор, который его держит.
 *
 * Одинаковое значение дальше не уходит: источник, приславший то же самое, ничего не
 * пересобирает. Отписанный ресурс забывает значение — без подписки оно могло протухнуть молча.
 */
export class Resource<T> {
  private readonly box: IObservableValue<T | Pending>;
  private stop: (() => void) | undefined;

  constructor(subscribe: Subscribe<T>) {
    this.box = observable.box<T | Pending>(PENDING, { deep: false, equals: sameValue });
    onBecomeObserved(this.box, () => {
      this.stop = subscribe((value) => later(() => this.box.set(value)));
    });
    onBecomeUnobserved(this.box, () => {
      this.stop?.();
      this.stop = undefined;
      later(() => this.box.set(PENDING));
    });
  }

  /** Значение или `PENDING`, пока не пришло. */
  get current(): T | Pending {
    return this.box.get();
  }

  /** Значение; пока не пришло — `undefined`. */
  get value(): T | undefined {
    const value = this.box.get();
    return value === PENDING ? undefined : value;
  }

  /** Пришло ли значение хоть раз с тех пор, как ресурс читают. */
  get ready(): boolean {
    return this.box.get() !== PENDING;
  }
}

/** Ресурс одного ответа: промис читается при первом чтении и больше не спрашивается. */
export const once = <T>(ask: () => Promise<T>): Resource<T> =>
  new Resource<T>((next) => {
    let alive = true;
    void ask().then((value) => {
      if (alive) next(value);
    });
    return () => {
      alive = false;
    };
  });
