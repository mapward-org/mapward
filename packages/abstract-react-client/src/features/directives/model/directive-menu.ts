import type { MapFile, MapObject } from "@mapward/core";
import { activeDirectives, menuDirectives } from "../../../kernel/directives.ts";
import { matches } from "../../../kernel/search.ts";
import { Anchor, Popup } from "../../../lib/store/popup.ts";
import { Reactive } from "../../../lib/store/reactive.ts";

/**
 * Что меню умеет, решает хост: нет действия — нет и его кнопки (решение 0014). Форма — порта
 * директив: спросить имя новой и открыть файл.
 */
export type DirectiveMenuHost = { ask: boolean; open?: ((file: MapFile) => void) | undefined };

/**
 * Пункт меню — директива строкой, той же, что на мета-экране. Этапов в меню нет: их запускают
 * из файла директивы, за ним в меню и идут (решение 0045).
 */

/**
 * Директивы объекта кнопкой с поиском — одна и та же в шапке экрана и карточки (решение 0045).
 * Все директивы объекта: незакрытые сверху, выполненные под ними, поиск идёт по всем.
 * Запрос никуда не сохраняется — закрыли меню, и он пуст, как у меню экшонов.
 */
export class DirectiveMenuStore extends Reactive {
  private readonly typed = this.state("");
  // Меню лежит порталом поверх всего — в шапке карточки его иначе обрезала бы её рамка.
  readonly popup = new Popup(() => this.clear(), true);
  readonly anchor = new Anchor();

  constructor(
    private readonly object: () => MapObject,
    private readonly host: () => DirectiveMenuHost,
    private readonly createNew: () => void,
  ) {
    super();
    // Открыто ли меню и где оно стоит — тоже его состояние: вид смотрит на один стор.
    this.depend(this.popup, this.anchor);
  }

  get query(): string {
    return this.typed.value;
  }

  /** Число на кнопке: незакрытые не лежат на виду, и счёт не даёт о них забыть. */
  get count(): number {
    return activeDirectives(this.object().directives).length;
  }

  get canOpen(): boolean {
    return this.host().open !== undefined;
  }

  get canCreate(): boolean {
    return this.host().ask;
  }

  get items(): MapFile[] {
    return menuDirectives(this.object().directives);
  }

  get found(): MapFile[] {
    return this.items.filter((file) => matches(this.query, file.name));
  }

  /** Что сказать, когда пунктов нет: директив нет вовсе или ничего не нашлось. */
  get empty(): string | undefined {
    if (this.items.length === 0) return "директив нет";
    return this.found.length === 0 ? "не нашлось" : undefined;
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

  open(file: MapFile): void {
    this.popup.close();
    this.host().open?.(file);
  }

  create(): void {
    this.popup.close();
    if (this.canCreate) this.createNew();
  }

  /** Enter открывает первую найденную — за этим директиву и ищут. */
  openFirst(): void {
    const first = this.found[0];
    if (first && this.canOpen) this.open(first);
  }

  mount(): void {
    this.popup.mount();
  }

  unmount(): void {
    this.popup.unmount();
  }
}
