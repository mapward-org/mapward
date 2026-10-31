import type { AppBridge, BridgeClient } from "@mapward/core";
import { once, type Feed } from "../../../lib/store/feed.ts";
import { Reactive, type State } from "../../../lib/store/reactive.ts";
import type { Snapshot } from "../../../kernel/snapshot.ts";

/**
 * Перекрытие ключа на странице снимка: значение из `viewState` снимка или то, что зовущий назвал
 * «всё раскрыто» (`expanded`), когда снимок просит `expand: "all"`. Записи — только в память.
 */
export type SlotOverride<T> = { value?: { value: T }; local: boolean };

/**
 * Состояние вида одного ключа: свёрнутые метрики, раскрытые папки, масштаб графа, история
 * сайдбара. У человека, в хранилище редактора, в репозиторий не попадает.
 *
 * Читается ресурсом: спрашивается, когда на ключ подписались, — поэтому тот, кто его читает,
 * зависит от него (`depend` или `useWatch`). Записанное здесь же сразу видно и уходит хосту.
 */
export class ViewSlot<T> extends Reactive {
  private readonly written: State<{ value: T } | undefined> = this.state<{ value: T } | undefined>(
    undefined,
  );
  private readonly stored: Feed<unknown>;

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly key: string,
    private readonly initial: T,
    /** Страница снимка: перекрытое значение и запись мимо хранилища человека. */
    private readonly override: SlotOverride<T> = { local: false },
  ) {
    super();
    // Прочитанное помнится и без подписки: вернувшийся вид (смена вкладки) рисуется с ним сразу —
    // раскрытые папки не схлопываются на кадр, пока хранилище отвечает заново.
    this.stored = once(() => bridge.getViewState({ key }), { keep: true });
    this.depend(this.stored);
  }

  /** Хранилище ответило — или уже записали сами. До этого значение — начальное или прочитанное раньше. */
  get ready(): boolean {
    return this.written.value !== undefined || this.stored.ready;
  }

  get value(): T {
    const written = this.written.value;
    if (written) return written.value;
    if (this.override.value) return this.override.value.value;
    const stored = this.stored.value;
    return stored === undefined ? this.initial : (stored as T);
  }

  set(value: T): void {
    this.written.set({ value });
    // Снимок не трогает настройки человека: его записи живут, пока жива страница.
    if (!this.override.local) void this.bridge.setViewState({ key: this.key, value });
  }
}

/**
 * Все ключи состояния вида: один `ViewSlot` на ключ, общий для всех, кто его читает. `snapshot` —
 * страница снимка: перекрытия из него и запись только в память.
 */
export class ViewStates {
  private readonly slots = new Map<string, ViewSlot<unknown>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly snapshot?: Snapshot,
  ) {}

  /**
   * `expanded` — каким ключ бывает, когда раскрыто всё: его отдаёт снимок с `expand: "all"`.
   * Обёрткой, потому что `undefined` тоже значение.
   */
  slot<T>(key: string, initial: T, expanded?: { value: T }): ViewSlot<T> {
    let slot = this.slots.get(key) as ViewSlot<T> | undefined;
    if (!slot) {
      slot = new ViewSlot<T>(this.bridge, key, initial, this.overrideOf(key, expanded));
      this.slots.set(key, slot as ViewSlot<unknown>);
    }
    return slot;
  }

  private overrideOf<T>(key: string, expanded: { value: T } | undefined): SlotOverride<T> {
    const snapshot = this.snapshot;
    if (!snapshot) return { local: false };
    const given = snapshot.viewState ?? {};
    if (Object.hasOwn(given, key)) return { value: { value: given[key] as T }, local: true };
    if (snapshot.expand === "all" && expanded) return { value: expanded, local: true };
    return { local: true };
  }
}
