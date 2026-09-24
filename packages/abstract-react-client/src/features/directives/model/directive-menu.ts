import { action, makeObservable, observable } from "mobx";
import type { MapFile, MapObject } from "@mapward/core";
import { activeDirectives, directiveLabel } from "../../../kernel/directives.ts";
import { matches } from "../../../kernel/search.ts";
import { Anchor, Popup } from "../../../lib/mobx/popup.ts";

/** Пункт меню: одна директива и один этап. */
export type StageItem = { key: string; file: MapFile; stage: string; label: string; busy: boolean };

/**
 * Директивы объекта в шапке карточки — списком с поиском, пункт на пару «директива · этап».
 * Только незакрытые: закрытых у старых объектов десятки, их смотрят на самом объекте. Запрос
 * никуда не сохраняется — закрыли меню, и он пуст, как у меню экшонов.
 */
export class DirectiveMenuStore {
  query = "";
  // Меню лежит порталом поверх всего — в шапке карточки его иначе обрезала бы её рамка.
  readonly popup = new Popup(() => this.clear(), true);
  readonly anchor = new Anchor();

  constructor(
    private readonly object: () => MapObject,
    private readonly run: (file: MapFile, stage: string) => void,
  ) {
    makeObservable<DirectiveMenuStore, "clear">(this, {
      query: observable,
      setQuery: action,
      clear: action,
    });
  }

  get items(): StageItem[] {
    const object = this.object();
    return activeDirectives(object.directives).flatMap((file) =>
      object.workflow.map((stage) => ({
        key: `${file.path}#${stage.name}`,
        file,
        stage: stage.name,
        label: `${directiveLabel(file)} · ${stage.name}`,
        busy: file.run?.stage === stage.name && file.run.finishedAt === undefined,
      })),
    );
  }

  get found(): StageItem[] {
    return this.items.filter((item) => matches(this.query, item.label, item.file.name));
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

  select(item: StageItem): void {
    this.popup.close();
    this.run(item.file, item.stage);
  }

  /** Enter запускает первый найденный — как у меню экшонов. */
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
