import { action, makeObservable, observable, observableRef } from "mobx";
import type {
  ArrowStyle,
  EditResult,
  LineEnd,
  MapOp,
  ObjectsMap,
  ViewRelation,
  ViewShape,
} from "@mapward/core";
import { confirmText, deleteOp, sameTool } from "../pure-model/tools.ts";
import type { Deletable, Popover, Tool } from "../pure-model/tools.ts";
import { overlay, reflected } from "../pure-model/pending.ts";
import type { PendingEdit } from "../pure-model/pending.ts";
import {
  createOp,
  editOps,
  lineShape,
  startEditing,
  styled,
  withDraft,
} from "../pure-model/edit.ts";
import type { Draft, Editing } from "../pure-model/edit.ts";
import { barFor, lookOf, patchFor, remember, stepField } from "../pure-model/bar.ts";
import type { BarKey, Field, Look, Menu, Target } from "../pure-model/bar.ts";

/** Сдвиг и масштаб холста — как их помнит холст. */
export type Viewport = { x: number; y: number; zoom: number };

type Slot<T> = { value: T; set(value: T): void };

type Edits = {
  edit(ops: MapOp[]): Promise<EditResult>;
  undo(id: string): Promise<EditResult>;
  redo(id: string): Promise<EditResult>;
  open(link: string): void;
};

/** Сколько подсказка висит тостом, прежде чем погаснуть сама. */
export const TOAST_MS = 6000;

/** Сколько правка держится после ответа сервера, если вьюха её так и не показала. */
export const PENDING_TTL_MS = 5000;

/** Уникальный номер фигуры: пометки живут в файле вьюхи и должны различаться между собой. */
export const shapeId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Вьюха карты одной метрики — решение 0044. Холст рисует и зовёт операции, а решает сервер;
 * здесь только то, что живёт, пока открыт вид: инструмент панели, открытый поповер, подпись,
 * которую правят, черновик брошенной карточки, диалог правки, ожидающие правки и стек отмены.
 * Масштаб и сдвиг — удобство смотрящего, они лежат в состоянии вида под адресом метрики.
 *
 * Стек свой у каждого, кто правит: Ctrl+Z человека не откатывает правку агента, потому что
 * пачки агента сюда не попадают вовсе.
 */
export class ObjectsMapStore {
  tool: Tool = { kind: "select" };
  popover: Popover | undefined = undefined;
  /** Отказ сервера или подсказка: показывается строкой на холсте до следующего действия. */
  message: { text: string; error: boolean } | undefined = undefined;
  /** Открытая выпадашка контекстной панели — одна за раз. */
  menu: Menu | undefined = undefined;
  /** Недавние цвета — в выпадашке цвета отдельным рядом. */
  recent: string[] = [];
  /** Раскрыт ли список прототипов «+» на рейке. */
  railMore = false;
  /** Узел, чью подпись правят на месте. */
  renaming: string | undefined = undefined;
  /** Удаление ждёт подтверждения — объект уносит с собой папку и связи. */
  confirming: Deletable | undefined = undefined;
  /** Брошенная карточка, которой ещё не дали имя. */
  draft: Draft | undefined = undefined;
  /** Открытый диалог «имя и адрес». */
  editing: Editing | undefined = undefined;
  /** Выделенная фигура — над ней панель стиля. */
  selected: { kind: "shape" | "arrow" | "object"; id: string } | undefined = undefined;
  /** Начало протягиваемой линии: второй клик ставит конец. */
  lineStart: LineEnd | undefined = undefined;
  /** Сколько правок в пути: пока сервер думает, холст знает, что узел ещё не на месте. */
  busy = 0;
  private pending: PendingEdit[] = [];
  /** Правки, чей срок после ответа сервера вышел: вьюха их так и не показала. */
  private expired: number[] = [];
  /** Последнее значение вьюхи по содержимому: снимок с тем же содержимым — тот же объект. */
  private canonical: { text: string; map: ObjectsMap } | undefined;
  private next = 0;
  private done: string[] = [];
  private undone: string[] = [];
  private readonly viewport: Slot<Viewport | undefined>;
  private cached:
    | {
        map: ObjectsMap;
        pending: PendingEdit[];
        expired: number[];
        draft: Draft | undefined;
        picture: ObjectsMap;
      }
    | undefined;

  constructor(
    private readonly edits: Edits,
    views: { slot<T>(key: string, initial: T): Slot<T> },
    address: string,
  ) {
    this.viewport = views.slot<Viewport | undefined>(`viewport:${address}`, undefined);
    makeObservable<
      ObjectsMapStore,
      "done" | "undone" | "settle" | "pending" | "answer" | "expired" | "expire"
    >(this, {
      tool: observableRef,
      popover: observableRef,
      message: observableRef,
      menu: observable,
      recent: observableRef,
      railMore: observable,
      toggleMenu: action,
      closeMenu: action,
      toggleRailMore: action,
      removeSelected: action,
      step: action,
      editSelected: action,
      diveSelected: action,
      escape: action,
      openRelation: action,
      apply: action,
      renaming: observable,
      confirming: observableRef,
      draft: observableRef,
      editing: observableRef,
      selected: observableRef,
      lineStart: observableRef,
      busy: observable,
      pending: observableRef,
      expired: observableRef,
      expire: action,
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
      answer: action,
      edit: action,
      undo: action,
      redo: action,
      remove: action,
      place: action,
      dropDraft: action,
      commitDraft: action,
      startEdit: action,
      closeEdit: action,
      save: action,
      select: action,
      style: action,
      lineAt: action,
      styleArrow: action,
    });
  }

  get view(): Viewport | undefined {
    return this.viewport.value;
  }

  /**
   * Картинка холста: значение вьюхи, ожидающие правки поверх и черновик. Тот же объект, пока
   * ничего из этого не поменялось, — холст пересобирает узлы только по делу.
   */
  picture(value: ObjectsMap): ObjectsMap {
    const map = this.same(value);
    const cached = this.cached;
    if (
      cached &&
      cached.map === map &&
      cached.pending === this.pending &&
      cached.expired === this.expired &&
      cached.draft === this.draft
    ) {
      return cached.picture;
    }
    const live = this.pending.filter((entry) => !this.expired.includes(entry.key));
    const picture = withDraft(overlay(map, live), this.draft);
    this.cached = { map, pending: this.pending, expired: this.expired, draft: this.draft, picture };
    return picture;
  }

  /**
   * Разбор значения метрики собирает новый объект на каждый снимок подписки, даже когда вьюха не
   * менялась. Здесь снимок с тем же содержимым становится прежним объектом — холст не
   * пересобирает узлы и не теряет выделение.
   */
  private same(value: ObjectsMap): ObjectsMap {
    if (this.canonical?.map === value) return value;
    const text = JSON.stringify(value);
    if (this.canonical?.text === text) return this.canonical.map;
    this.canonical = { text, map: value };
    return value;
  }

  /**
   * К какому узлу холста пристёгнут поповер — меню стоит рядом с объектом и едет за зумом.
   * Объекта на холсте нет (список склеенных связей) — `undefined`, меню встаёт в угол.
   */
  popoverNode(map: ObjectsMap): string | undefined {
    const popover = this.popover;
    if (popover?.kind !== "object") return undefined;
    return this.picture(map).nodes.some((node) => node.id === popover.address)
      ? popover.address
      : undefined;
  }

  /** Узел холста под панелью стиля; у линии узла нет — панель встаёт в угол. */
  styleNode(map: ObjectsMap): string | undefined {
    const shape = this.selectedShape(map);
    return shape && shape.kind !== "line" ? `shape:${shape.id}` : undefined;
  }

  /** Выделенная связь — у неё своё меню: толщина, цвета, размер подписи, режим пути. */
  selectedArrow(map: ObjectsMap): ViewRelation | undefined {
    const chosen = this.selected;
    if (chosen?.kind !== "arrow") return undefined;
    return this.picture(map).relations.find((arrow) => arrow.id === chosen.id);
  }

  /** Выбран ли этот инструмент — подсветка кнопки боковой панели. */
  isTool(tool: Tool): boolean {
    return sameTool(this.tool, tool);
  }

  /** Что спросить перед удалением, пока оно ждёт подтверждения. */
  get confirmText(): string | undefined {
    return this.confirming && confirmText(this.confirming);
  }

  /** Фигура под панелью стиля — из картинки, чтобы панель видела свою же правку сразу. */
  selectedShape(map: ObjectsMap): ViewShape | undefined {
    const chosen = this.selected;
    if (chosen?.kind !== "shape") return undefined;
    return this.picture(map).shapes.find((shape) => shape.id === chosen.id);
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
    this.lineStart = undefined;
  }

  open(popover: Popover): void {
    this.popover = popover;
  }

  closePopover(): void {
    this.popover = undefined;
  }

  /**
   * Подсказка — тостом, который гаснет сам через 6 с. Отказ сервера держится до закрытия: его
   * надо прочитать.
   */
  say(message: string | undefined, error = false): void {
    this.message = message === undefined ? undefined : { text: message, error };
    if (message !== undefined && !error) {
      const shown = this.message;
      setTimeout(() => this.hush(shown), TOAST_MS);
    }
  }

  private hush(shown: ObjectsMapStore["message"]): void {
    if (this.message === shown) this.say(undefined);
  }

  toggleMenu(menu: Menu): void {
    this.menu = this.menu === menu ? undefined : menu;
  }

  closeMenu(): void {
    this.menu = undefined;
  }

  toggleRailMore(): void {
    this.railMore = !this.railMore;
  }

  /** Выделенное как цель панели: фигура, стрелка или объект — из картинки, с правками поверх. */
  target(map: ObjectsMap): Target | undefined {
    const chosen = this.selected;
    if (!chosen) return undefined;
    const picture = this.picture(map);
    if (chosen.kind === "shape") {
      const shape = picture.shapes.find((one) => one.id === chosen.id);
      return shape && { kind: "shape", shape };
    }
    if (chosen.kind === "arrow") {
      const arrow = picture.relations.find((one) => one.id === chosen.id);
      return arrow && { kind: "arrow", arrow };
    }
    const node = picture.nodes.find((one) => one.id === chosen.id);
    return node && { kind: "object", node };
  }

  /** Кнопки панели у выделенного — только применимые к его виду. */
  bar(map: ObjectsMap): BarKey[] {
    const target = this.target(map);
    return target ? barFor(target) : [];
  }

  look(map: ObjectsMap): Look {
    return lookOf(this.target(map));
  }

  /**
   * Где стоит панель: у узла — над ним; у стрелки и линии — у середины пути. Узла у фигуры —
   * `shape:<id>`, у линии узла нет.
   */
  barAt(map: ObjectsMap): { node?: string; edge?: string } | undefined {
    const target = this.target(map);
    if (!target) return undefined;
    if (target.kind === "object") return { node: target.node.id };
    if (target.kind === "arrow") return { edge: target.arrow.id };
    return target.shape.kind === "line"
      ? { edge: `line:${target.shape.id}` }
      : { node: `shape:${target.shape.id}` };
  }

  /** Значение из выпадашки: фигура и стрелка правятся каждая своей операцией. */
  async apply(field: Field, value: string | number | undefined, map: ObjectsMap): Promise<void> {
    const target = this.target(map);
    if (!target || target.kind === "object") return;
    if (typeof value === "string" && value.startsWith("#"))
      this.recent = remember(this.recent, value);
    const patch = patchFor(target, field, value);
    if (target.kind === "shape") await this.style(patch as Partial<ViewShape>, map);
    else await this.styleArrow(patch as Partial<ArrowStyle>, map);
  }

  /** Степпер −/+ выпадашки: размер текста или толщина выделенного. */
  async step(field: "fontSize" | "width", delta: number, map: ObjectsMap): Promise<void> {
    const look = this.look(map);
    await this.apply(
      field,
      stepField(field, field === "fontSize" ? look.fontSize : look.width, delta),
      map,
    );
  }

  /** Где стоит поповер: у узла объекта справа; нет узла — у середины стрелки, по которой кликнули. */
  popoverAt(map: ObjectsMap): { node?: string; edge?: string } | undefined {
    const popover = this.popover;
    if (!popover) return undefined;
    const node = this.popoverNode(map);
    if (node) return { node };
    return popover.edge === undefined ? undefined : { edge: popover.edge };
  }

  /** Строка списка склеенных связей: поповер той же стрелки, но уже с этой связью. */
  openRelation(link: string): void {
    const edge = this.popover?.edge;
    this.popover = { kind: "object", address: link, ...(edge === undefined ? {} : { edge }) };
  }

  /** Адрес объекта в поповере — для его кнопок ✎ ↘. */
  get popoverAddress(): string | undefined {
    return this.popover?.kind === "object" ? this.popover.address : undefined;
  }

  get popoverItems(): { label: string; link: string }[] {
    return this.popover?.kind === "relations" ? this.popover.items : [];
  }

  /** «Править» с панели: объект — его диалог. */
  editSelected(map: ObjectsMap): void {
    const target = this.target(map);
    this.menu = undefined;
    if (target?.kind === "object") this.startEdit(target.node.id, map);
  }

  /** «Провалиться» с панели: объект — он сам, стрелка — связь, из которой она. */
  diveSelected(map: ObjectsMap): void {
    const target = this.target(map);
    this.menu = undefined;
    if (target?.kind === "object") this.dive(target.node.object);
    else if (target?.kind === "arrow" && target.arrow.link) this.dive(target.arrow.link);
  }

  /** Esc: закрыть выпадашку, потом поповер. */
  escape(): void {
    if (this.menu) this.menu = undefined;
    else this.popover = undefined;
  }

  /** Удалить выделенное — через то же подтверждение, что клавиша Delete. */
  removeSelected(map: ObjectsMap): void {
    const target = this.target(map);
    this.menu = undefined;
    if (!target) return;
    if (target.kind === "object") {
      this.ask({ kind: target.node.kind, id: target.node.id, label: target.node.label });
    } else if (target.kind === "shape") {
      this.ask({ kind: "shape", id: target.shape.id, label: target.shape.text || "фигура" });
    } else if (target.arrow.link) {
      this.ask({ kind: "object", id: target.arrow.link, label: target.arrow.label ?? "связь" });
    }
  }

  /** Подсказка у курсора, пока выбран инструмент, который ставит что-то кликом. */
  get cursorHint(): string | undefined {
    switch (this.tool.kind) {
      case "object":
      case "shape":
        return "клик по холсту — поставить";
      case "line":
        return this.lineStart ? "клик — конец линии" : "клик — начало линии";
      case "relation":
        return "тяни от узла к узлу — связь";
      default:
        return undefined;
    }
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
   * Холст сообщает выделение на каждой своей перерисовке, а не только когда оно поменялось:
   * библиотека зовёт обработчик заново, как только получила новую функцию. Новый объект с тем же
   * выделением снова перерисовал бы холст — и так по кругу, карта висла на клике по связи.
   * Поэтому то же самое выделение не записывается.
   */
  select(chosen: { kind: "shape" | "arrow" | "object"; id: string } | undefined): void {
    const now = this.selected;
    if (now?.kind === chosen?.kind && now?.id === chosen?.id) return;
    this.selected = chosen;
    this.menu = undefined;
  }

  /** Карточка брошена: видна сразу с полем подписи, на диск уйдёт по Enter. */
  place(draft: Draft): void {
    this.draft = draft;
    this.tool = { kind: "select" };
  }

  dropDraft(): void {
    this.draft = undefined;
  }

  /** Enter в подписи черновика: одна операция «создать» уже с именем. Пустое — как Esc. */
  async commitDraft(name: string, map: ObjectsMap): Promise<void> {
    const draft = this.draft;
    this.draft = undefined;
    const op = draft && createOp(map.view, draft, name);
    if (op) await this.edit([op], map);
  }

  startEdit(address: string, map: ObjectsMap): void {
    this.popover = undefined;
    this.editing = startEditing(this.picture(map), address);
  }

  closeEdit(): void {
    this.editing = undefined;
  }

  /** Диалог сохранён: имя и адрес одной пачкой — одна отмена. */
  async save(name: string, folder: string, map: ObjectsMap): Promise<void> {
    const editing = this.editing;
    this.editing = undefined;
    if (!editing) return;
    const ops = editOps(map.view, editing, name, folder);
    if (ops.length > 0) await this.edit(ops, map);
  }

  /** Стиль выделенной фигуры: та же операция «положить фигуру», что при создании. */
  async style(patch: Partial<ViewShape>, map: ObjectsMap): Promise<void> {
    const shape = this.selectedShape(map);
    if (shape)
      await this.edit([{ op: "put-shape", view: map.view, shape: styled(shape, patch) }], map);
  }

  /** Стиль выделенной связи: операция уносит стиль целиком, поверх прежнего. */
  async styleArrow(patch: Partial<ArrowStyle>, map: ObjectsMap): Promise<void> {
    const arrow = this.selectedArrow(map);
    if (!arrow) return;
    const style = styled({ ...arrow.style }, patch);
    await this.edit([{ op: "style-arrow", view: map.view, arrow: arrow.id, style }], map);
  }

  /** Клик с инструментом «линия»: первый ставит начало, второй — конец и саму линию. */
  async lineAt(end: LineEnd, map: ObjectsMap): Promise<void> {
    const start = this.lineStart;
    if (!start) {
      this.lineStart = end;
      return;
    }
    this.lineStart = undefined;
    this.tool = { kind: "select" };
    await this.edit(
      [{ op: "put-shape", view: map.view, shape: lineShape(shapeId(), start, end) }],
      map,
    );
  }

  /**
   * Пачка операций. Ожидаемый результат ложится на холст сразу, до ответа. Удалась — номер
   * уходит в стек отмены, а повтор отменённого теряет смысл. Отказ — правка снимается, узел
   * возвращается, причина строкой на холсте; `false` говорит об этом холсту.
   */
  async edit(ops: MapOp[], map: ObjectsMap): Promise<boolean> {
    this.message = undefined;
    this.busy += 1;
    const key = (this.next += 1);
    const sent = this.same(map);
    // Отражённые и просроченные уже не нужны — копить их незачем.
    this.pending = [
      ...this.pending.filter(
        (entry) => !this.expired.includes(entry.key) && !reflected(sent, entry),
      ),
      { key, ops, sent },
    ];
    const result = await this.edits.edit(ops);
    this.answer(key, result.ok);
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
  async remove(map: ObjectsMap): Promise<void> {
    const target = this.confirming;
    this.cancel();
    if (!target) return;
    await this.edit([deleteOp(map.view, target)], map);
  }

  /** Ответ сервера: удалась — правка ждёт, пока вьюха её отразит; отказ — снимается сразу. */
  private answer(key: number, ok: boolean): void {
    if (!ok) {
      this.pending = this.pending.filter((entry) => entry.key !== key);
      return;
    }
    setTimeout(() => this.expire(key), PENDING_TTL_MS);
  }

  private expire(key: number): void {
    this.expired = [...this.expired, key];
  }

  private settle(result: EditResult, apply: (id: string) => void): boolean {
    this.busy -= 1;
    if (!result.ok) {
      this.say(result.error, true);
      return false;
    }
    apply(result.id);
    return true;
  }
}
