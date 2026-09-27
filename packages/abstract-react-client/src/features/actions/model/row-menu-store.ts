import type { ActionRef } from "@mapward/core";
import { Anchor, Popup } from "../../../lib/mobx/popup.ts";

/**
 * Меню строки списка и узла дерева: экшоны, которые строка назвала в `actions`. Открывается
 * кнопкой «⋯» и правым кликом по строке — это одно и то же меню. Поиска нет: у строки экшонов
 * несколько, а не десятки, как у объекта в шапке.
 */
export class RowMenuStore {
  // Порталом поверх всего: строку дерева иначе обрезала бы клетка метрики с прокруткой.
  readonly popup = new Popup(undefined, true);
  readonly anchor = new Anchor();

  constructor(private readonly run: (ref: ActionRef) => void) {}

  /** Кнопка «⋯»: место меряется по ней в момент открытия. */
  toggle(button: HTMLElement): void {
    this.anchor.measure(button);
    this.popup.toggle();
  }

  /** Правый клик: меню встаёт у курсора. */
  openAt(x: number, y: number): void {
    this.anchor.point(x, y);
    this.popup.show();
  }

  select(ref: ActionRef): void {
    this.popup.close();
    this.run(ref);
  }

  mount(): void {
    this.popup.mount();
  }

  unmount(): void {
    this.popup.unmount();
  }
}
