import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Observable } from "rxjs";
import type { Watchable } from "./reactive.ts";

/**
 * Связь потоков с React — единственная. Вид подписывается на сторы, которые читает, и
 * перерисовывается, когда любой из них поменялся. Это вторая точка клиента, где состояние держит
 * сам React (первая — `useLocalStore`), и записана она в тесте слоёв путём.
 */
export function useWatch(...stores: (Watchable | undefined)[]): void {
  const version = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscriptions = stores.map((store) =>
        store?.changed$.subscribe(() => {
          version.current += 1;
          notify();
        }),
      );
      return () => {
        for (const subscription of subscriptions) subscription?.unsubscribe();
      };
    },
    // Набор сторов — то, на что подписаны; новый стор — новая подписка.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    stores,
  );
  // Третий аргумент — для отрисовки без браузера (тесты первого кадра): кадр один, подписки нет.
  useSyncExternalStore(
    subscribe,
    () => version.current,
    () => version.current,
  );
}

/**
 * Последнее значение потока. Пока поток молчит — `initial`. Поток с текущим значением
 * (`BehaviorSubject` и всё, что из него выведено) отвечает сразу, первым же рендером.
 */
export function useValue<T>(source: Observable<T>, initial: T): T {
  const latest = useRef<{ source: Observable<T>; value: T }>({ source, value: initial });
  if (latest.current.source !== source) latest.current = { source, value: initial };
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = source.subscribe((value) => {
        if (Object.is(value, latest.current.value)) return;
        latest.current = { source, value };
        notify();
      });
      return () => subscription.unsubscribe();
    },
    [source],
  );
  return useSyncExternalStore(
    subscribe,
    () => latest.current.value,
    () => latest.current.value,
  );
}
