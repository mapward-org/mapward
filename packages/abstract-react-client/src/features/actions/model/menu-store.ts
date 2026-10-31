import type { MapAction } from "@mapward/core";
import { Anchor, Popup } from "../../../lib/store/popup.ts";
import { Reactive } from "../../../lib/store/reactive.ts";
import { matchActions } from "../pure-model/actions.ts";

/**
 * Все экшоны объекта в шапке — решение 0038: список с поиском внутри вида, а не окном
 * редактора. Поиск стоит сразу: от прототипа экшонов приезжает много, и нужен обычно один.
 * Запрос, как и у поиска директив, никуда не сохраняется — закрыли меню, и он пуст.
 */
export class MenuStore extends Reactive {
  private readonly typed = this.state("");
  // Меню лежит порталом поверх всего — в шапке карточки его иначе обрезала бы её рамка.
  readonly popup = new Popup(() => this.clear(), true);
  readonly anchor = new Anchor();

  constructor(
    private readonly actions: () => MapAction[],
    private readonly run: (action: MapAction) => void,
  ) {
    super();
    // Открыто ли меню и где оно стоит — тоже его состояние: вид смотрит на один стор.
    this.depend(this.popup, this.anchor);
  }

  get query(): string {
    return this.typed.value;
  }

  get found(): MapAction[] {
    return matchActions(this.actions(), this.query);
  }

  /** Кнопка меню: место меряется по ней в момент открытия. */
  toggle(button: HTMLElement): void {
    this.anchor.measure(button);
    this.popup.toggle();
  }

  setQuery(query: string): void {
    this.typed.set(query);
  }

  private clear(): void {
    this.typed.set("");
  }

  select(target: MapAction): void {
    this.popup.close();
    this.run(target);
  }

  /** Enter запускает первый найденный: набрал имя — и запустил, не трогая мышь. */
  runFirst(): void {
    const first = this.found[0];
    if (first) this.select(first);
  }

  mount(): void {
    this.popup.mount();
  }

  unmount(): void {
    this.popup.unmount();
  }
}
