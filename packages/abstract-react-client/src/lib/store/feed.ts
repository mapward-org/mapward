import { Observable, share } from "rxjs";
import type { Watchable } from "./reactive.ts";

const sameValue = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null &&
    JSON.stringify(a) === JSON.stringify(b));

/**
 * Ресурс — ленивая подписка на поток моста. Подписывается на источник, когда на него подписался
 * первый вид (или стор, который от него зависит), и отписывается, когда не осталось никого.
 * Логики у него нет: что из значения следует, считает стор, который его держит.
 *
 * Одинаковое значение дальше не уходит. Отписанный ресурс забывает значение — без подписки оно
 * могло протухнуть молча. `keep` — помнить последнее и после отписки: так ресурс, который вид
 * бросает и снова берёт (сборка компонента при смене вкладки), сразу показывает прежнее, пока
 * источник не ответил заново; ответ тем же значением дальше не уходит, другим — заменяет его.
 */
export class Feed<T> implements Watchable {
  private current: T | undefined;
  private has = false;
  readonly changed$: Observable<unknown>;

  constructor(source: Observable<T>, options: { keep?: boolean } = {}) {
    this.changed$ = new Observable<unknown>((subscriber) => {
      const subscription = source.subscribe({
        next: (value) => {
          const known = this.has || (options.keep === true && this.current !== undefined);
          if (known && sameValue(this.current, value)) {
            this.has = true;
            return;
          }
          this.current = value;
          this.has = true;
          subscriber.next(value);
        },
        // Упавший поток — не повод ронять вид: значение остаётся прежним.
        error: () => undefined,
      });
      return () => {
        subscription.unsubscribe();
        this.has = false;
        if (options.keep !== true) this.current = undefined;
      };
    }).pipe(share());
  }

  /** Значение; пока не пришло — `undefined` (с `keep` — прежнее, если оно было). */
  get value(): T | undefined {
    return this.current;
  }

  /** Пришло ли значение с тех пор, как на ресурс подписаны. */
  get ready(): boolean {
    return this.has;
  }
}

/** Ресурс одного ответа: промис спрашивается при подписке. `options` — как у `Feed`. */
export const once = <T>(ask: () => Promise<T>, options: { keep?: boolean } = {}): Feed<T> =>
  new Feed(
    new Observable<T>((subscriber) => {
      let alive = true;
      void ask().then((value) => {
        if (alive) subscriber.next(value);
      });
      return () => {
        alive = false;
      };
    }),
    options,
  );
