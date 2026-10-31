import type { Observable } from "rxjs";
import { MAP_ROOT } from "@mapward/core";
import type { AppBridge, BridgeClient, MapObject } from "@mapward/core";
import { Feed } from "../../../lib/store/feed.ts";
import { Reactive } from "../../../lib/store/reactive.ts";

type Ref = { mapPath: string; basePath: string; name: string };
type Crumb = { address: string; name: string };

/** Пока предки не пришли — один и тот же пустой список: от него считают крошки с тождеством. */
const NONE: Crumb[] = [];

/**
 * Карта одного вида. Модель карты одна — у сервера; клиент её не собирает, а смотрит на объекты
 * по адресу: каждый — ресурс моста, подписанный, пока на него кто-то смотрит. Объект приходит со
 * своими полями и ближайшими детьми без внуков.
 *
 * Стор, который читает объект, зависит от его ресурса (`feed`): тогда изменение объекта — это и
 * его изменение.
 */
export class MapView extends Reactive {
  private readonly objects = new Map<string, Feed<MapObject | null>>();
  private readonly lines = new Map<string, Feed<Crumb[]>>();
  private readonly reloadingState = this.state(false);

  constructor(
    private readonly bridge: BridgeClient<AppBridge>,
    readonly ref: Ref,
  ) {
    super();
  }

  /** Объект по адресу ресурсом. Тот же ресурс на тот же адрес. */
  feed(address: string): Feed<MapObject | null> {
    let feed = this.objects.get(address);
    if (!feed) {
      // Схема ответа в контракте — `unknown`: форму объекта знает `core`, а не мост.
      feed = new Feed(
        this.bridge.watchObject({ ...this.ref, address }) as Observable<MapObject | null>,
      );
      this.objects.set(address, feed);
    }
    return feed;
  }

  /** Предки объекта ресурсом — для крошек. */
  ancestorsFeed(address: string): Feed<Crumb[]> {
    let feed = this.lines.get(address);
    if (!feed) {
      feed = new Feed(this.bridge.watchAncestors({ ...this.ref, address }));
      this.lines.set(address, feed);
    }
    return feed;
  }

  get rootFeed(): Feed<MapObject | null> {
    return this.feed(MAP_ROOT);
  }

  /** Объект, если он пришёл и есть; иначе `undefined`. Подписку держит тот, кто зависит от ресурса. */
  object(address: string): MapObject | undefined {
    return this.feed(address).value ?? undefined;
  }

  /** Есть ли объект: пришёл ответ, и это не `null`. Пока ответа нет — «не знаю», то есть нет. */
  has(address: string): boolean {
    return this.object(address) !== undefined;
  }

  /** Сервер ответил, что объекта по адресу нет. Пока ответа нет — не знаем, значит `false`. */
  missing(address: string): boolean {
    const feed = this.feed(address);
    return feed.ready && feed.value === null;
  }

  ancestors(address: string): Crumb[] {
    return this.ancestorsFeed(address).value ?? NONE;
  }

  /** Корень пришёл: имя и вкладки уже настоящие, можно рисовать. */
  get ready(): boolean {
    return this.rootFeed.ready;
  }

  get reloading(): boolean {
    return this.reloadingState.value;
  }

  /** Перечитать карту. Пока идёт, кнопка гаснет, чтобы второй клик не заводил второго. */
  reload(): void {
    if (this.reloading) return;
    this.reloadingState.set(true);
    void this.bridge.reloadMap(this.ref).finally(() => this.reloadingState.set(false));
  }
}
