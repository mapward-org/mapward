import { action, makeObservable, observable } from "mobx";
import { once, type Resource } from "@mapward/core";
import type { AppBridge, BridgeClient } from "@mapward/core";

type Ref = { mapPath: string; basePath: string; name: string };
export type Terminal = { id: string; name: string };

/**
 * Терминалы объекта живут, пока их держит редактор: список — то, что открыто сейчас. После
 * открытия и закрытия список спрашивается заново — сам хост об этом не сообщает.
 */
export class Terminals {
  private version = 0;
  private readonly lists = new Map<string, Resource<Terminal[]>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
    private readonly address: () => string,
  ) {
    makeObservable<Terminals, "version">(this, { version: observable, refresh: action });
  }

  get list(): Terminal[] {
    const key = `${this.address()}#${this.version}`;
    let list = this.lists.get(key);
    if (!list) {
      const address = this.address();
      list = once(() => this.bridge.listTerminals({ address }));
      this.lists.set(key, list);
    }
    return list.value ?? [];
  }

  refresh(): void {
    this.version += 1;
  }

  private after<T>(promise: Promise<T>): void {
    void promise.then(() => this.refresh());
  }

  open(fresh?: boolean): void {
    this.after(this.bridge.openObjectTerminal({ ...this.ref, address: this.address(), fresh }));
  }

  /**
   * Кнопка этапа: фраза уходит в живую сессию объекта, промпт агент берёт из MCP сам —
   * решение 0017. Сессию выбирает хост, клиент про неё ничего не знает.
   */
  runStage(directive: string, stage: string): void {
    this.after(this.bridge.runStage({ ...this.ref, address: this.address(), directive, stage }));
  }

  /** Показать именно тот, по которому кликнули: терминалов у объекта может быть несколько. */
  show(id: string): void {
    void this.bridge.showTerminal({ id });
  }

  close(id: string): void {
    this.after(this.bridge.closeTerminal({ id }));
  }
}
