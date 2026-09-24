import { computed, makeObservable } from "mobx";
import type { MapObject } from "@mapward/core";
import { cardView, type CardView } from "../pure-model/card.ts";

/**
 * Карточка объекта: объект и его вкладка по адресу, пришедшему в данных метрики.
 * Вид держится `computed`: сетка внутри карточки заводит подписку по объекту и списку метрик,
 * и новый массив на каждом рендере означал бы новую подписку на каждом рендере.
 */
export class CardStore {
  constructor(
    private readonly find: (address: string) => MapObject | undefined,
    readonly address: string,
    private readonly group: string | undefined,
  ) {
    makeObservable(this, { view: computed });
  }

  get view(): CardView {
    return cardView(this.find(this.address), this.address, this.group);
  }

  get object(): MapObject | undefined {
    return this.view.kind === "missing-object" ? undefined : this.view.object;
  }

  get note(): string | undefined {
    const view = this.view;
    return view.kind === "missing-object" || view.kind === "missing-group" ? view.note : undefined;
  }

  /** Вкладка превью, когда её есть что показать; иначе у карточки одна шапка или сообщение. */
  get preview(): Extract<CardView, { kind: "preview" }> | undefined {
    return this.view.kind === "preview" ? this.view : undefined;
  }

  get hasActions(): boolean {
    return (this.object?.actions.length ?? 0) > 0;
  }
}
