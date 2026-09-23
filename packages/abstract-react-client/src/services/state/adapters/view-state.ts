import { action, makeObservable, observableRef } from "mobx";
import { once, type Resource } from "@mapward/core";
import type { AppBridge, BridgeClient } from "@mapward/core";

/**
 * Состояние вида одного ключа: свёрнутые метрики, раскрытые папки, масштаб графа, история
 * сайдбара. У человека, в хранилище редактора, в репозиторий не попадает.
 *
 * Читается один раз, при первом чтении; записанное здесь же сразу видно и уходит хосту.
 */
export class ViewSlot<T> {
  private written: { value: T } | undefined;
  private readonly stored: Resource<unknown>;

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly key: string,
    private readonly initial: T,
  ) {
    this.stored = once(() => bridge.getViewState({ key }));
    makeObservable<ViewSlot<T>, "written">(this, { written: observableRef, set: action });
  }

  /** Хранилище ответило — или уже записали сами. До этого значение — начальное. */
  get ready(): boolean {
    return this.written !== undefined || this.stored.ready;
  }

  get value(): T {
    if (this.written) return this.written.value;
    const stored = this.stored.value;
    return stored === undefined ? this.initial : (stored as T);
  }

  set(value: T): void {
    this.written = { value };
    void this.bridge.setViewState({ key: this.key, value });
  }
}

/** Все ключи состояния вида: один `ViewSlot` на ключ, общий для всех, кто его читает. */
export class ViewStates {
  private readonly slots = new Map<string, ViewSlot<unknown>>();

  constructor(private readonly bridge: BridgeClient<AppBridge>) {}

  slot<T>(key: string, initial: T): ViewSlot<T> {
    let slot = this.slots.get(key) as ViewSlot<T> | undefined;
    if (!slot) {
      slot = new ViewSlot<T>(this.bridge, key, initial);
      this.slots.set(key, slot as ViewSlot<unknown>);
    }
    return slot;
  }
}
