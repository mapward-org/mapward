import type { AppBridge, BridgeClient } from "@mapward/core";
import { once, type Feed } from "../../../lib/store/feed.ts";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";

type Ref = { mapPath: string; basePath: string; name: string };
export type Terminal = { id: string; name: string };

/**
 * Терминалы объектов живут, пока их держит редактор: список — то, что открыто сейчас. После
 * открытия и закрытия список спрашивается заново — сам хост об этом не сообщает.
 *
 * Объект — параметр вызова, а не то, что зашито при сборке вида: у экрана он открытый, а у
 * карточки на чужом экране — свой. Список спрашивается, только когда его читают: двадцать
 * карточек на карте не должны означать двадцать запросов при открытии.
 *
 * Список объекта — ресурс: спрашивается, пока на него подписаны. Вид, читающий `list`, зовёт
 * `useWatch(terminals, terminals.watch(address))`: сам стор меняется, когда список устарел, и
 * `watch` после этого отдаёт новый ресурс.
 */
export class Terminals extends Reactive {
  private readonly lists = new Map<string, Feed<Terminal[]>>();

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    private readonly ref: Ref,
  ) {
    super();
  }

  private feed(address: string): Feed<Terminal[]> {
    let list = this.lists.get(address);
    if (!list) {
      list = once(() => this.bridge.listTerminals({ address }));
      this.lists.set(address, list);
    }
    return list;
  }

  /** Ресурс списка объекта — на него подписывается тот, кто список читает. */
  watch(address: string): Watchable {
    return this.feed(address);
  }

  list(address: string): Terminal[] {
    return this.feed(address).value ?? [];
  }

  /** Список устарел: следующий `watch` отдаст новый ресурс, и тот спросит заново. */
  refresh(): void {
    this.lists.clear();
    this.touch();
  }

  private after<T>(promise: Promise<T>): void {
    void promise.then(() => this.refresh());
  }

  open(address: string, fresh?: boolean): void {
    this.after(this.bridge.openObjectTerminal({ ...this.ref, address, fresh }));
  }

  /**
   * Кнопка этапа: фраза уходит в живую сессию объекта, промпт агент берёт из MCP сам —
   * решение 0017. Сессию выбирает хост, клиент про неё ничего не знает.
   */
  runStage(address: string, directive: string, stage: string): void {
    this.after(this.bridge.runStage({ ...this.ref, address, directive, stage }));
  }

  /** Показать именно тот, по которому кликнули: терминалов у объекта может быть несколько. */
  show(id: string): void {
    void this.bridge.showTerminal({ id });
  }

  close(id: string): void {
    this.after(this.bridge.closeTerminal({ id }));
  }
}
