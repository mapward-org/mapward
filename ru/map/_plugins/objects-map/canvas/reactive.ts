import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BehaviorSubject, merge, switchMap, type Observable } from "rxjs";

/**
 * Сторы холста на потоках — как у клиента карты, откуда холст приехал: стор держит состояние в
 * `State`, геттеры считают из него синхронно, а наружу отдаёт один поток `changed$` — «во мне
 * что-то поменялось». Вид подписывается на него `useWatch` и перерисовывается; что читать, он
 * берёт геттерами. Логика холста так остаётся в классах и проверяется тестами без React.
 */

/** То, на что вид умеет подписаться. */
export type Watchable = { readonly changed$: Observable<unknown> };

/** Одно поле стора: значение сейчас и поток его изменений. Одинаковое значение не шумит. */
export class State<T> {
  private readonly subject: BehaviorSubject<T>;

  constructor(
    initial: T,
    private readonly onChange?: () => void,
  ) {
    this.subject = new BehaviorSubject(initial);
  }

  get value(): T {
    return this.subject.value;
  }

  get value$(): Observable<T> {
    return this.subject.asObservable();
  }

  set(next: T): void {
    if (Object.is(next, this.subject.value)) return;
    this.subject.next(next);
    this.onChange?.();
  }

  update(change: (previous: T) => T): void {
    this.set(change(this.subject.value));
  }
}

export abstract class Reactive implements Watchable {
  private readonly bump = new BehaviorSubject(0);
  private readonly sources: Observable<unknown>[] = [this.bump];
  private merged: Observable<unknown> | undefined;

  /** Изменилось ли что-то в сторе или в том, из чего он собран. */
  get changed$(): Observable<unknown> {
    this.merged ??= merge(...this.sources);
    return this.merged;
  }

  /** Поле стора: его изменение — изменение стора. */
  protected state<T>(initial: T): State<T> {
    return new State(initial, () => this.touch());
  }

  /** Стор собран из других: их изменения — его изменения. Объявляется в конструкторе. */
  protected depend(...sources: (Watchable | undefined)[]): void {
    for (const source of sources) if (source) this.sources.push(source.changed$);
    this.merged = undefined;
  }

  /**
   * Источники, которые меняются вместе с состоянием: экран смотрит на объект по текущему
   * адресу, и сменился адрес — сменился и источник. Поток отдаёт набор источников, стор слушает
   * последний набор.
   */
  protected dependOn(sources$: Observable<(Watchable | undefined)[]>): void {
    this.sources.push(
      sources$.pipe(
        switchMap((sources) =>
          merge(
            ...sources.filter((source) => source !== undefined).map((source) => source.changed$),
          ),
        ),
      ),
    );
    this.merged = undefined;
  }

  /** Поменялось то, чего `State` не видит: мутация внутри, пришедшее извне. */
  protected touch(): void {
    this.bump.next(this.bump.value + 1);
  }
}

/**
 * Стор, у которого есть жизнь: подписки, слушатели окна, таймеры. Заводит их `mount`, а снимает
 * `unmount` — не конструктор: React в строгом режиме монтирует компонент дважды, и то, что
 * завёл конструктор, после первого снятия пропало бы навсегда.
 */
export type Mountable = { mount?: () => void; unmount?: () => void };

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/**
 * Локальный стор компонента: `useLocalStore(() => new Store(…))`. Стор создаётся один раз на
 * жизнь компонента; изменились `deps` — создаётся новый, а старый снимается.
 */
export function useLocalStore<T extends object & Mountable>(
  create: () => T,
  deps: readonly unknown[] = [],
): T {
  const [slot, setSlot] = useState(() => ({ deps, store: create() }));
  let current = slot;
  if (!same(slot.deps, deps)) {
    current = { deps, store: create() };
    setSlot(current);
  }
  const store = current.store;
  useEffect(() => {
    store.mount?.();
    return () => store.unmount?.();
  }, [store]);
  return store;
}

/**
 * Связь потоков с React: вид подписывается на сторы, которые читает, и перерисовывается, когда
 * любой из них поменялся.
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
