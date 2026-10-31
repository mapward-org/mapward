import type { MapObject } from "@mapward/core";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";
import { cardView, LOADING_CARD, type CardView } from "../pure-model/card.ts";

/**
 * Что карточке нужно от карты: объект по адресу и его ресурс. Объект приходит с сервера: пока не
 * пришёл — `undefined`, а `ready` у ресурса говорит, ответил ли сервер вообще.
 */
export type CardMap = {
  object(address: string): MapObject | undefined;
  feed(address: string): Watchable & { readonly ready: boolean };
};

/**
 * Карточка объекта: объект и его вкладка по адресу, пришедшему в данных метрики. Стор зависит от
 * ресурса объекта: пришёл или поменялся объект — поменялась и карточка.
 *
 * Вид запоминается по объекту: сетка внутри карточки заводит подписку по объекту и списку
 * метрик, и новый массив на каждом рендере означал бы новую подписку на каждом рендере.
 */
export class CardStore extends Reactive {
  private readonly feed: Watchable & { readonly ready: boolean };
  private last: { object: MapObject | undefined; ready: boolean; value: CardView } | undefined;

  constructor(
    private readonly map: CardMap,
    readonly address: string,
    private readonly group: string | undefined,
  ) {
    super();
    this.feed = map.feed(address);
    this.depend(this.feed);
  }

  get view(): CardView {
    const object = this.map.object(this.address);
    const ready = this.feed.ready;
    const last = this.last;
    if (last && last.object === object && last.ready === ready) return last.value;
    const value = ready ? cardView(object, this.address, this.group) : LOADING_CARD;
    this.last = { object, ready, value };
    return value;
  }

  get object(): MapObject | undefined {
    const view = this.view;
    return view.kind === "missing-object" || view.kind === "loading" ? undefined : view.object;
  }

  get note(): string | undefined {
    const view = this.view;
    return view.kind === "missing-object" ||
      view.kind === "missing-group" ||
      view.kind === "loading"
      ? view.note
      : undefined;
  }

  /** Вкладка превью, когда её есть что показать; иначе у карточки одна шапка или сообщение. */
  get preview(): Extract<CardView, { kind: "preview" }> | undefined {
    return this.view.kind === "preview" ? this.view : undefined;
  }

  get hasActions(): boolean {
    return (this.object?.actions.length ?? 0) > 0;
  }
}
