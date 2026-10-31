import { BehaviorSubject, merge, switchMap, type Observable } from "rxjs";

/**
 * Сторы клиента на потоках — без MobX. Стор держит состояние в `State`, геттеры считают из него
 * синхронно, а наружу отдаёт один поток `changed$`: «во мне что-то поменялось». Вид подписывается
 * на него хуком `useWatch` и перерисовывается; что именно читать, он берёт геттерами, как раньше.
 *
 * Зависимость стора от другого стора или ресурса объявляется явно — `depend`: тогда изменение
 * источника — это и изменение стора, и виду не нужно знать, из чего стор собран.
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
