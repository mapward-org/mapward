import { action, makeObservable, observable, reaction } from "mobx";
import type { Run } from "@mapward/core";
import { inTab, pretty, type RunsTab } from "../pure-model/runs.ts";

/** Вкладка экрана — состояние вида: помнится у человека, в историю не идёт. */
export type TabSlot = { value: RunsTab; set(value: RunsTab): void };

/**
 * Экран прогонов — решение 0038. Прогоны приходят сверху, выбор живёт в истории экрана
 * (решение 0036): «назад» возвращает к тому прогону, который читали. Время идущего прогона
 * тикает само: подписка приносит только смену шагов, а не секунды.
 */
export class RunsScreenStore {
  now = Date.now();
  private stop: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly runs: () => Run[],
    private readonly selected: () => string | undefined,
    private readonly tabSlot: TabSlot,
  ) {
    makeObservable<RunsScreenStore, "tick">(this, { now: observable, tick: action });
  }

  get tab(): RunsTab {
    return this.tabSlot.value;
  }

  setTab(tab: RunsTab): void {
    this.tabSlot.set(tab);
  }

  get total(): number {
    return this.runs().length;
  }

  get shown(): Run[] {
    return inTab(this.runs(), this.tab);
  }

  /**
   * Названный прогон показывается, даже если он с другой вкладки: на него ведёт красная точка
   * метрики, и прятать его за вкладкой значило бы вести в пустоту.
   */
  get open(): Run | undefined {
    const id = this.selected();
    const named = id === undefined ? undefined : this.runs().find((run) => run.id === id);
    return named ?? this.shown[0];
  }

  /** Данные формы открытого прогона — строкой, как их показывают. */
  get inputs(): [string, string][] {
    return Object.entries(this.open?.inputs ?? {}).map(([name, value]) => [
      name,
      typeof value === "string" ? value : JSON.stringify(value),
    ]);
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
    this.now = Date.now();
  }

  mount(): void {
    this.stop = reaction(
      () => this.running,
      (running) => {
        this.tick();
        this.halt();
        if (running) this.timer = setInterval(() => this.tick(), 1000);
      },
      { fireImmediately: true },
    );
  }

  unmount(): void {
    this.stop?.();
    this.halt();
  }

  private halt(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
