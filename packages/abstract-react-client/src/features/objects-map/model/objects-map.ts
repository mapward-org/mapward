import { action, makeObservable, observable, observableRef } from "mobx";
import type { EditResult, MapOp } from "@mapward/core";
import { confirmText, deleteOp, sameTool } from "../pure-model/tools.ts";
import type { Deletable, Popover, Tool } from "../pure-model/tools.ts";

/** Сдвиг и масштаб холста — как их помнит холст. */
export type Viewport = { x: number; y: number; zoom: number };

type Slot<T> = { value: T; set(value: T): void };

type Edits = {
  edit(ops: MapOp[]): Promise<EditResult>;
  undo(id: string): Promise<EditResult>;
  redo(id: string): Promise<EditResult>;
  open(link: string): void;
};

/**
 * Вьюха карты одной метрики — решение 0044. Холст рисует и зовёт операции, а решает сервер;
 * здесь только то, что живёт, пока открыт вид: инструмент панели, открытый поповер, подпись,
 * которую правят, и стек отмены. Масштаб и сдвиг — удобство смотрящего, они лежат в состоянии
 * вида под адресом метрики.
 *
 * Стек свой у каждого, кто правит: Ctrl+Z человека не откатывает правку агента, потому что
 * пачки агента сюда не попадают вовсе.
 */
export class ObjectsMapStore {
  tool: Tool = { kind: "select" };
  popover: Popover | undefined = undefined;
  /** Отказ сервера или подсказка: показывается строкой на холсте до следующего действия. */
  message: string | undefined = undefined;
  /** Узел, чью подпись правят на месте. */
  renaming: string | undefined = undefined;
  /** Удаление ждёт подтверждения — объект уносит с собой папку и связи. */
  confirming: Deletable | undefined = undefined;
  /** Сколько правок в пути: пока сервер думает, холст знает, что узел ещё не на месте. */
  busy = 0;
  private done: string[] = [];
  private undone: string[] = [];
  private readonly viewport: Slot<Viewport | undefined>;

  constructor(
    private readonly edits: Edits,
    views: { slot<T>(key: string, initial: T): Slot<T> },
    address: string,
  ) {
    this.viewport = views.slot<Viewport | undefined>(`viewport:${address}`, undefined);
    makeObservable<ObjectsMapStore, "done" | "undone" | "settle">(this, {
      tool: observableRef,
      popover: observableRef,
      message: observable,
      renaming: observable,
      confirming: observableRef,
      busy: observable,
      done: observableRef,
      undone: observableRef,
      choose: action,
      open: action,
      closePopover: action,
      dive: action,
      say: action,
      rename: action,
      ask: action,
      cancel: action,
      settle: action,
      edit: action,
      undo: action,
      redo: action,
      remove: action,
    });
  }

  get view(): Viewport | undefined {
    return this.viewport.value;
  }

  /** Выбран ли этот инструмент — подсветка кнопки боковой панели. */
  isTool(tool: Tool): boolean {
    return sameTool(this.tool, tool);
  }

  /** Что спросить перед удалением, пока оно ждёт подтверждения. */
  get confirmText(): string | undefined {
    return this.confirming && confirmText(this.confirming);
  }

  /** «Провалиться» из поповера: он закрывается, объект открывается. */
  dive(link: string): void {
    this.popover = undefined;
    this.edits.open(link);
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  pan(viewport: Viewport): void {
    this.viewport.set(viewport);
  }

  choose(tool: Tool): void {
    this.tool = tool;
    this.message = undefined;
  }

  open(popover: Popover): void {
    this.popover = popover;
  }

  closePopover(): void {
    this.popover = undefined;
  }

  say(message: string | undefined): void {
    this.message = message;
  }

  rename(id: string | undefined): void {
    this.renaming = id;
  }

  ask(target: Deletable): void {
    this.confirming = target;
  }

  cancel(): void {
    this.confirming = undefined;
  }

  /**
   * Пачка операций. Удалась — её номер уходит в стек отмены, а повтор отменённого теряет
   * смысл. Отказ — причина строкой на холсте; `false` говорит холсту вернуть узел на место.
   */
  async edit(ops: MapOp[]): Promise<boolean> {
    this.message = undefined;
    this.busy += 1;
    const result = await this.edits.edit(ops);
    return this.settle(result, (id) => {
      this.done = [...this.done, id];
      this.undone = [];
    });
  }

  async undo(): Promise<void> {
    const id = this.done.at(-1);
    if (id === undefined) return;
    this.busy += 1;
    const result = await this.edits.undo(id);
    this.settle(result, () => {
      this.done = this.done.slice(0, -1);
      this.undone = [...this.undone, id];
    });
  }

  async redo(): Promise<void> {
    const id = this.undone.at(-1);
    if (id === undefined) return;
    this.busy += 1;
    const result = await this.edits.redo(id);
    this.settle(result, () => {
      this.undone = this.undone.slice(0, -1);
      this.done = [...this.done, id];
    });
  }

  /** Удалить подтверждённое: объект — с папкой и связями, ссылку — со вьюхи, фигуру — с холста. */
  async remove(view: string): Promise<void> {
    const target = this.confirming;
    this.cancel();
    if (!target) return;
    await this.edit([deleteOp(view, target)]);
  }

  private settle(result: EditResult, apply: (id: string) => void): boolean {
    this.busy -= 1;
    if (!result.ok) {
      this.message = result.error;
      return false;
    }
    apply(result.id);
    return true;
  }
}
