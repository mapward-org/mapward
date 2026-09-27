import { action, makeObservable, observable } from "mobx";
import type { MapFile, MapObject } from "@mapward/core";
import {
  activeDirectives,
  directiveHint,
  directiveHintClass,
  directiveLabel,
  isRunning,
} from "../../../kernel/directives.ts";
import { matches } from "../../../kernel/search.ts";
import { Anchor, Popup } from "../../../lib/mobx/popup.ts";

/**
 * Пункт меню — одна незакрытая директива. Этапов в меню нет: их запускают из файла директивы,
 * за ним в меню и идут (решение 0045).
 */
export type DirectiveItem = {
  file: MapFile;
  label: string;
  hint: string;
  hintClass: string;
  busy: boolean;
};

/**
 * Что меню умеет, решает хост: нет действия — нет и его кнопки (решение 0014). Форма — порта
 * директив: спросить имя новой и открыть файл.
 */
export type DirectiveMenuHost = { ask: boolean; open?: ((file: MapFile) => void) | undefined };

/**
 * Директивы объекта кнопкой с поиском — одна и та же в шапке экрана и карточки (решение 0045).
 * Только незакрытые: закрытых у старых объектов десятки, их смотрят на экране «об объекте».
 * Запрос никуда не сохраняется — закрыли меню, и он пуст, как у меню экшонов.
 */
export class DirectiveMenuStore {
  query = "";
  // Меню лежит порталом поверх всего — в шапке карточки его иначе обрезала бы её рамка.
  readonly popup = new Popup(() => this.clear(), true);
  readonly anchor = new Anchor();

  constructor(
    private readonly object: () => MapObject,
    private readonly host: () => DirectiveMenuHost,
    private readonly createNew: () => void,
  ) {
    makeObservable<DirectiveMenuStore, "clear">(this, {
      query: observable,
      setQuery: action,
      clear: action,
    });
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

  get items(): DirectiveItem[] {
    return activeDirectives(this.object().directives).map((file) => ({
      file,
      label: directiveLabel(file),
      hint: directiveHint(file),
      hintClass: directiveHintClass(file),
      busy: isRunning(file),
    }));
  }

  get found(): DirectiveItem[] {
    return this.items.filter((item) => matches(this.query, item.file.name));
  }

  /** Что сказать, когда пунктов нет: незакрытых нет вовсе или ничего не нашлось. */
  get empty(): string | undefined {
    if (this.items.length === 0) return "незакрытых нет";
    return this.found.length === 0 ? "не нашлось" : undefined;
  }

  /** Кнопка меню: место меряется по ней в момент открытия. */
  toggle(button: HTMLElement): void {
    this.anchor.measure(button);
    this.popup.toggle();
  }

  setQuery(query: string): void {
    this.query = query;
  }

  private clear(): void {
    this.query = "";
  }

  open(item: DirectiveItem): void {
    this.popup.close();
    this.host().open?.(item.file);
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
