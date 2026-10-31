import { Reactive, type State } from "../../../lib/store/reactive.ts";
import type { PluginStream } from "../pure-model/plugin-stream.ts";
import type { CallSlot } from "./call-memory.ts";

export type { PluginStream };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Запрос к плагину на время жизни компонента: подписка в `mount`, отписка в `unmount` — это и
 * есть отмена, плагин её видит. Ошибка не стирает прошлое значение: честнее показать вчерашнее
 * с пометкой, чем пустоту. `memory` — последний ответ того же ключа: с него запрос и начинается,
 * `status` при этом — `loading`, пока плагин не ответит заново.
 */
export class QueryStore<T> extends Reactive {
  private readonly current = this.state<"loading" | "success" | "error">("loading");
  private readonly answer: State<T | undefined>;
  private readonly failure = this.state<string | undefined>(undefined);
  private subscription: { unsubscribe(): void } | undefined;
  private release: (() => void) | undefined;

  constructor(
    private readonly query: () => PluginStream<T>,
    private readonly memory?: CallSlot<T>,
  ) {
    super();
    this.answer = this.state<T | undefined>(memory?.last()?.value);
  }

  get status(): "loading" | "success" | "error" {
    return this.current.value;
  }

  get data(): T | undefined {
    return this.answer.value;
  }

  get error(): string | undefined {
    return this.failure.value;
  }

  mount(): void {
    this.release = this.memory?.hold();
    this.subscribe();
  }

  unmount(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.release?.();
    this.release = undefined;
  }

  /** Спросить заново: прошлое значение остаётся на экране, пока не придёт новое. Полем — уходит в обработчик. */
  readonly refetch = (): void => {
    this.subscription?.unsubscribe();
    this.current.set("loading");
    this.subscribe();
  };

  private subscribe(): void {
    try {
      this.subscription = this.query().subscribe({
        next: (value) => this.next(value),
        error: (error) => this.fail(error),
        complete: () => this.done(),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  private next(value: T): void {
    this.memory?.remember(value);
    this.answer.set(value);
    this.failure.set(undefined);
    this.current.set("success");
  }

  private done(): void {
    // Поток кончился без значения — ответ пустой, но это ответ.
    if (this.current.value === "loading") this.next(undefined as T);
  }

  private fail(error: unknown): void {
    this.failure.set(message(error));
    this.current.set("error");
  }
}

/**
 * Поток, пока компонент на экране: каждое значение, а не только первое. `memory` — как у
 * запроса: `last` с первого кадра — прошлое значение того же ключа, `status` — `connecting`.
 */
export class StreamStore<T> extends Reactive {
  private readonly current = this.state<"connecting" | "open" | "done" | "error">("connecting");
  private readonly latest: State<T | undefined>;
  private readonly failure = this.state<string | undefined>(undefined);
  private subscription: { unsubscribe(): void } | undefined;
  private release: (() => void) | undefined;

  constructor(
    private readonly stream: () => PluginStream<T>,
    private readonly memory?: CallSlot<T>,
  ) {
    super();
    this.latest = this.state<T | undefined>(memory?.last()?.value);
  }

  get status(): "connecting" | "open" | "done" | "error" {
    return this.current.value;
  }

  get last(): T | undefined {
    return this.latest.value;
  }

  get error(): string | undefined {
    return this.failure.value;
  }

  mount(): void {
    this.release = this.memory?.hold();
    this.subscribe();
  }

  /** Подписаться заново: прошлое значение остаётся, пока не придёт новое. Полем — в обработчик. */
  readonly refetch = (): void => {
    this.subscription?.unsubscribe();
    this.current.set("connecting");
    this.subscribe();
  };

  private subscribe(): void {
    try {
      this.subscription = this.stream().subscribe({
        next: (value) => {
          this.memory?.remember(value);
          this.latest.set(value);
          this.current.set("open");
        },
        error: (error) => this.fail(error),
        complete: () => this.current.set("done"),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  unmount(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.release?.();
    this.release = undefined;
  }

  private fail(error: unknown): void {
    this.failure.set(message(error));
    this.current.set("error");
  }
}

/** Изменение по вызову: клик, форма. Новый запуск отменяет идущий, уход с экрана — тоже. */
export class MutationStore<A, T> extends Reactive {
  private readonly current = this.state<"idle" | "running" | "success" | "error">("idle");
  private readonly answer = this.state<T | undefined>(undefined);
  private readonly failure = this.state<string | undefined>(undefined);
  private subscription: { unsubscribe(): void } | undefined;

  constructor(private readonly mutate: (args: A) => PluginStream<T>) {
    super();
  }

  get status(): "idle" | "running" | "success" | "error" {
    return this.current.value;
  }

  get data(): T | undefined {
    return this.answer.value;
  }

  get error(): string | undefined {
    return this.failure.value;
  }

  unmount(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  /** Полем, а не методом: `run` уходит в обработчик клика отдельно от стора. */
  readonly run = (args: A): void => {
    this.unmount();
    this.current.set("running");
    this.failure.set(undefined);
    try {
      this.subscription = this.mutate(args).subscribe({
        next: (value) => this.answer.set(value),
        error: (error) => this.fail(error),
        complete: () => this.current.set("success"),
      });
    } catch (error) {
      this.fail(error);
    }
  };

  private fail(error: unknown): void {
    this.failure.set(message(error));
    this.current.set("error");
  }
}
