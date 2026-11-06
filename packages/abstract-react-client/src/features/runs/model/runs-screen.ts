import { distinctUntilChanged, map, startWith, type Subscription } from "rxjs";
import type { Run } from "@mapward/core";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";
import { inTab, pretty, type RunsTab } from "../pure-model/runs.ts";

/** Вкладка экрана — состояние вида: помнится у человека, в историю не идёт. */
export type TabSlot = Watchable & { readonly value: RunsTab; set(value: RunsTab): void };

/** Прогоны объекта: список и поток его изменений. */
export type RunsSource = Watchable & { readonly list: Run[] };

/**
 * Экран прогонов — решение 0038. Прогоны приходят сверху, выбор живёт в истории экрана
 * (решение 0036): «назад» возвращает к тому прогону, который читали. Время идущего прогона
 * тикает само: подписка приносит только смену шагов, а не секунды.
 */
export class RunsScreenStore extends Reactive {
  private readonly clock = this.state(Date.now());
  private stop: Subscription | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly source: RunsSource,
    private readonly selected: () => string | undefined,
    private readonly tabSlot: TabSlot,
  ) {
    super();
    this.depend(source, tabSlot);
  }

  get now(): number {
    return this.clock.value;
  }

  private runs(): Run[] {
    return this.source.list;
  }

  get tab(): RunsTab {
    return this.tabSlot.value;
  }

  setTab(tab: RunsTab): void {
    this.tabSlot.set(tab);
  }

  get shown(): Run[] {
    return inTab(this.runs(), this.tab);
  }

  /**
   * Названный прогон показывается, даже если он с другой вкладки: на него ведёт красная точка
   * метрики, и прятать его за вкладкой значило бы вести в пустоту. Не названный или ушедший из
   * лога — справа основной вид, лог объекта (директива «логи плагинов»), а не самый свежий прогон.
   */
  get open(): Run | undefined {
    const id = this.selected();
    return id === undefined ? undefined : this.runs().find((run) => run.id === id);
  }

  /** Справа лог объекта, а не прогон. */
  get logOpen(): boolean {
    return this.open === undefined;
  }

  /** Данные формы открытого прогона — строкой, как их показывают. */
  get inputs(): [string, string][] {
    return Object.entries(this.open?.inputs ?? {}).map(([name, value]) => [
      name,
      typeof value === "string" ? value : JSON.stringify(value),
    ]);
  }

  /** Итог метода экшона — то, что он отдал, кроме сообщений о ходе. */
  get result(): string | undefined {
    const result = this.open?.result;
    return result === undefined ? undefined : pretty(result);
  }

  /** Конфиг — после подстановок: тот, по которому прогон действительно шёл. */
  get config(): string | undefined {
    const config = this.open?.config;
    return config === undefined ? undefined : pretty(config);
  }

  private get running(): boolean {
    return this.runs().some((run) => run.status === "running");
  }

  private tick(): void {
    this.clock.set(Date.now());
  }

  mount(): void {
    this.stop = this.source.changed$
      .pipe(
        startWith(undefined),
        map(() => this.running),
        distinctUntilChanged(),
      )
      .subscribe((running) => {
        this.tick();
        this.halt();
        if (running) this.timer = setInterval(() => this.tick(), 1000);
      });
  }

  unmount(): void {
    this.stop?.unsubscribe();
    this.halt();
  }

  private halt(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
