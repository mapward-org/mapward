import type { EditResult, MapOp } from "../model/ops.ts";
import type {
  ArrowStyle,
  LineEnd,
  ObjectsMap,
  Side,
  ViewRelation,
  ViewShape,
} from "../model/types.ts";
import { layout, pinnedEnds } from "./layout.ts";
import { confirmText, deleteOp, sameTool } from "./tools.ts";
import type { Deletable, Popover, Tool } from "./tools.ts";
import { overlay, reflected } from "./pending.ts";
import type { PendingEdit } from "./pending.ts";
import {
  createOp,
  editOps,
  frameName,
  lineShape,
  startEditing,
  styled,
  withDraft,
} from "./edit.ts";
import type { Draft, Editing } from "./edit.ts";
import { barFor, lookOf, patchFor, remember, stepField } from "./bar.ts";
import type { BarKey, Field, Look, Menu, Target } from "./bar.ts";
import { showBeside } from "./copy.ts";
import { rememberedArrow, rememberStyle, withRemembered } from "./remembered.ts";
import type { Remembered } from "./remembered.ts";
import { Reactive, type Watchable } from "./reactive.ts";

/** Сдвиг и масштаб холста — как их помнит холст. */
export type Viewport = { x: number; y: number; zoom: number };

/**
 * Ключ состояния вида. Если он умеет сообщать о своих изменениях (пришло из хранилища), стор
 * от него зависит; записанное самим стором стор видит и так.
 */
type Slot<T> = { value: T; set(value: T): void } & Partial<Watchable>;

const watchable = (slot: Slot<unknown>): Watchable | undefined =>
  slot.changed$ ? { changed$: slot.changed$ } : undefined;

type Chosen = { kind: "shape" | "arrow" | "object"; id: string };

type Edits = {
  edit(ops: MapOp[]): Promise<EditResult>;
  undo(id: string): Promise<EditResult>;
  redo(id: string): Promise<EditResult>;
  open(link: string): void;
};

/** Сколько подсказка висит тостом, прежде чем погаснуть сама. */
export const TOAST_MS = 6000;

/** Сколько правка держится после ответа плагина, если вьюха её так и не показала. */
export const PENDING_TTL_MS = 5000;

/** Уникальный номер фигуры: пометки живут в файле вьюхи и должны различаться между собой. */
export const shapeId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Вьюха карты одной метрики — решение 0044. Холст рисует и зовёт операции, а решает плагин `objects-map`;
 * здесь только то, что живёт, пока открыт вид: инструмент панели, открытый поповер, подпись,
 * которую правят, черновик брошенной карточки, диалог правки, ожидающие правки и стек отмены.
 * Масштаб и сдвиг — удобство смотрящего, они лежат в состоянии вида под адресом метрики.
 *
 * Стек свой у каждого, кто правит: Ctrl+Z человека не откатывает правку агента, потому что
 * пачки агента сюда не попадают вовсе.
 */
export class ObjectsMapStore extends Reactive {
  private readonly toolState = this.state<Tool>({ kind: "select" });
  private readonly popoverState = this.state<Popover | undefined>(undefined);
  /** Отказ плагина или подсказка: показывается строкой на холсте до следующего действия. */
  private readonly messageState = this.state<{ text: string; error: boolean } | undefined>(
    undefined,
  );
  /** Открытая выпадашка контекстной панели — одна за раз. */
  private readonly menuState = this.state<Menu | undefined>(undefined);
  /** Недавние цвета — в выпадашке цвета отдельным рядом. */
  private readonly recentState = this.state<string[]>([]);
  /** Раскрыт ли список прототипов «+» на рейке. */
  private readonly railMoreState = this.state(false);
  /** Узел, чью подпись правят на месте. */
  private readonly renamingState = this.state<string | undefined>(undefined);
  /** Удаление ждёт подтверждения — объект уносит с собой папку и связи. */
  private readonly confirmingState = this.state<Deletable | undefined>(undefined);
  /** Брошенная карточка, которой ещё не дали имя. */
  private readonly draftState = this.state<Draft | undefined>(undefined);
  /** Открытый диалог «имя и адрес». */
  private readonly editingState = this.state<Editing | undefined>(undefined);
  /** Выделенная фигура — над ней панель стиля. */
  private readonly selectedState = this.state<Chosen | undefined>(undefined);
  /** Начало протягиваемой линии: второй клик ставит конец. */
  private readonly lineStartState = this.state<LineEnd | undefined>(undefined);
  /** Сколько правок в пути: пока плагин думает, холст знает, что узел ещё не на месте. */
  private readonly busyState = this.state(0);
  private readonly pendingState = this.state<PendingEdit[]>([]);
  /** Правки, чей срок после ответа плагина вышел: вьюха их так и не показала. */
  private readonly expiredState = this.state<number[]>([]);
  private readonly doneState = this.state<string[]>([]);
  private readonly undoneState = this.state<string[]>([]);
  /** Последнее значение вьюхи по содержимому: снимок с тем же содержимым — тот же объект. */
  private canonical: { text: string; map: ObjectsMap } | undefined;
  private next = 0;
  private readonly viewport: Slot<Viewport | undefined>;
  /**
   * Свёрнута ли рейка инструментов — когда карту смотрят, а не правят. Настройка смотрящего, а не
   * вьюхи: одна на все холсты и переживает перезагрузку окна.
   */
  private readonly rail: Slot<boolean>;
  /** Последние настройки фигур, линий и связей — как в Miro; тоже настройка смотрящего. */
  private readonly remembered: Slot<Remembered>;
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
    super();
    this.viewport = views.slot<Viewport | undefined>(`viewport:${address}`, undefined);
    this.rail = views.slot<boolean>("objects-map:rail-folded", false);
    this.remembered = views.slot<Remembered>("objects-map:last-style", {});
    // Настройки смотрящего лежат в состоянии вида: ответ хранилища — изменение стора.
    this.depend(watchable(this.viewport), watchable(this.rail), watchable(this.remembered));
  }

  get tool(): Tool {
    return this.toolState.value;
  }

  get popover(): Popover | undefined {
    return this.popoverState.value;
  }

  get message(): { text: string; error: boolean } | undefined {
    return this.messageState.value;
  }

  get menu(): Menu | undefined {
    return this.menuState.value;
  }

  get recent(): string[] {
    return this.recentState.value;
  }

  get railMore(): boolean {
    return this.railMoreState.value;
  }

  get renaming(): string | undefined {
    return this.renamingState.value;
  }

  get confirming(): Deletable | undefined {
    return this.confirmingState.value;
  }

  get draft(): Draft | undefined {
    return this.draftState.value;
  }

  get editing(): Editing | undefined {
    return this.editingState.value;
  }

  get selected(): Chosen | undefined {
    return this.selectedState.value;
  }

  get lineStart(): LineEnd | undefined {
    return this.lineStartState.value;
  }

  get busy(): number {
    return this.busyState.value;
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

  private get pending(): PendingEdit[] {
    return this.pendingState.value;
  }

  private get expired(): number[] {
    return this.expiredState.value;
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
    this.popoverState.set(undefined);
    this.edits.open(link);
  }

  get canUndo(): boolean {
    return this.doneState.value.length > 0;
  }

  get canRedo(): boolean {
    return this.undoneState.value.length > 0;
  }

  pan(viewport: Viewport): void {
    this.viewport.set(viewport);
    this.touch();
  }

  choose(tool: Tool): void {
    this.toolState.set(tool);
    this.messageState.set(undefined);
    this.lineStartState.set(undefined);
  }

  open(popover: Popover): void {
    this.popoverState.set(popover);
  }

  closePopover(): void {
    this.popoverState.set(undefined);
  }

  /**
   * Подсказка — тостом, который гаснет сам через 6 с. Отказ плагина держится до закрытия: его
   * надо прочитать.
   */
  say(message: string | undefined, error = false): void {
    const shown = message === undefined ? undefined : { text: message, error };
    this.messageState.set(shown);
    if (message !== undefined && !error) {
      setTimeout(() => this.hush(shown), TOAST_MS);
    }
  }

  private hush(shown: ObjectsMapStore["message"]): void {
    if (this.message === shown) this.say(undefined);
  }

  toggleMenu(menu: Menu): void {
    this.menuState.update((open) => (open === menu ? undefined : menu));
  }

  closeMenu(): void {
    this.menuState.set(undefined);
  }

  toggleRailMore(): void {
    this.railMoreState.update((open) => !open);
  }

  get railFolded(): boolean {
    return this.rail.value;
  }

  /** Свернуть или развернуть рейку; свёрнутая уносит с собой и список «+». */
  toggleRail(): void {
    this.rail.set(!this.rail.value);
    this.railMoreState.set(false);
    this.touch();
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
      this.recentState.update((recent) => remember(recent, value));
    const patch = patchFor(target, field, value);
    const kind = target.kind === "shape" ? target.shape.kind : "arrow";
    this.remembered.set(rememberStyle(this.remembered.value, kind, patch));
    this.touch();
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

  /** Строка списка склеенных связей: поповер той же стрелки, но уже с этой связью. */
  openRelation(link: string): void {
    const edge = this.popover?.edge;
    this.popoverState.set({
      kind: "object",
      address: link,
      ...(edge === undefined ? {} : { edge }),
    });
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
    this.menuState.set(undefined);
    // У копии правится её объект: своего имени у копии нет.
    if (target?.kind === "object") this.startEdit(target.node.object, map);
  }

  /** «Провалиться» с панели: объект — он сам, стрелка — связь, из которой она. */
  diveSelected(map: ObjectsMap): void {
    const target = this.target(map);
    this.menuState.set(undefined);
    if (target?.kind === "object") this.dive(target.node.object);
    else if (target?.kind === "arrow" && target.arrow.link) this.dive(target.arrow.link);
  }

  /** «Копия-отображение» с панели: тот же объект ещё раз, рядом с выделенным узлом. */
  async showSelected(map: ObjectsMap): Promise<void> {
    const target = this.target(map);
    this.menuState.set(undefined);
    if (target?.kind !== "object" || target.node.expanded) return;
    const picture = this.picture(map);
    const box = layout(picture).find((one) => one.id === target.node.id);
    if (!box) return;
    await this.edit(
      [
        showBeside({
          view: picture.view,
          object: target.node.object,
          parent: target.node.parent,
          box,
          taken: new Set(picture.nodes.map((one) => one.id)),
        }),
      ],
      map,
    );
  }

  /** Esc: закрыть выпадашку, потом поповер. */
  escape(): void {
    if (this.menu) this.menuState.set(undefined);
    else this.popoverState.set(undefined);
  }

  /** Удалить выделенное — через то же подтверждение, что клавиша Delete. */
  removeSelected(map: ObjectsMap): void {
    const target = this.target(map);
    this.menuState.set(undefined);
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
        return this.tool.frame ? "тяни рамку — фрейм" : "клик по холсту — поставить";
      case "shape":
        return "тяни — нарисовать, клик — обычного размера";
      case "line":
        return this.lineStart ? "клик — конец линии" : "тяни от начала к концу";
      case "relation":
        return "тяни от узла к узлу — связь";
      default:
        return undefined;
    }
  }

  rename(id: string | undefined): void {
    this.renamingState.set(id);
  }

  ask(target: Deletable): void {
    this.confirmingState.set(target);
  }

  cancel(): void {
    this.confirmingState.set(undefined);
  }

  /**
   * Холст сообщает выделение на каждой своей перерисовке, а не только когда оно поменялось:
   * библиотека зовёт обработчик заново, как только получила новую функцию. Новый объект с тем же
   * выделением снова перерисовал бы холст — и так по кругу, карта висла на клике по связи.
   * Поэтому то же самое выделение не записывается.
   */
  select(chosen: Chosen | undefined): void {
    const now = this.selected;
    if (now?.kind === chosen?.kind && now?.id === chosen?.id) return;
    this.selectedState.set(chosen);
    this.menuState.set(undefined);
  }

  /**
   * Карточка брошена: видна сразу с полем подписи, на диск уйдёт по Enter. Фрейм подписи не
   * ждёт — создаётся сразу с именем прототипа из палитры, переименовывают его потом.
   */
  place(draft: Draft, map: ObjectsMap): void {
    this.toolState.set({ kind: "select" });
    const name = frameName(map, draft.prototype);
    if (name === undefined) {
      this.draftState.set(draft);
      return;
    }
    const op = createOp(map.view, draft, name);
    if (op) void this.edit([op], map);
  }

  dropDraft(): void {
    this.draftState.set(undefined);
  }

  /** Enter в подписи черновика: одна операция «создать» уже с именем. Пустое — как Esc. */
  async commitDraft(name: string, map: ObjectsMap): Promise<void> {
    const draft = this.draft;
    this.draftState.set(undefined);
    const op = draft && createOp(map.view, draft, name);
    if (op) await this.edit([op], map);
  }

  startEdit(address: string, map: ObjectsMap): void {
    this.popoverState.set(undefined);
    this.editingState.set(startEditing(this.picture(map), address));
  }

  closeEdit(): void {
    this.editingState.set(undefined);
  }

  /** Диалог сохранён: имя и адрес одной пачкой — одна отмена. */
  async save(name: string, folder: string, map: ObjectsMap): Promise<void> {
    const editing = this.editing;
    this.editingState.set(undefined);
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
      this.lineStartState.set(end);
      return;
    }
    this.lineStartState.set(undefined);
    this.toolState.set({ kind: "select" });
    await this.drawShape(lineShape(shapeId(), start, end), map);
  }

  /** Линия протянута мышью: сразу оба конца, одна операция. */
  async drawLine(from: LineEnd, to: LineEnd, map: ObjectsMap): Promise<void> {
    this.lineStartState.set(undefined);
    await this.drawShape(lineShape(shapeId(), from, to), map);
  }

  /** Новая фигура или линия — в последнем стиле своего вида; инструмент снова «выбор». */
  async drawShape(shape: ViewShape, map: ObjectsMap): Promise<void> {
    this.toolState.set({ kind: "select" });
    const dressed = withRemembered(shape, this.remembered.value);
    await this.edit([{ op: "put-shape", view: map.view, shape: dressed }], map);
  }

  /**
   * Новая связь — в последнем стиле связей. Стиль лежит у стрелки вьюхи, а стрелка зовётся
   * парой видимых концов; есть уже такая — связь склеится с ней, и её стиль не трогается.
   */
  /**
   * Связь, проведённая на холсте: концы закрепляются за стороны, за которую тянули и на которую
   * отпустили. Запомненный стиль ложится на новую стрелку целиком, поэтому несёт то же закрепление,
   * что плагин напишет операцией связи, — иначе стёр бы его.
   */
  async relate(
    from: string,
    to: string,
    prototype: string,
    map: ObjectsMap,
    sides: { from?: Side | undefined; to?: Side | undefined } = {},
  ): Promise<void> {
    this.toolState.set({ kind: "select" });
    const view = map.view;
    const ops: MapOp[] = [
      {
        op: "create-relation",
        view,
        from,
        to,
        prototype,
        ...(sides.from === undefined ? {} : { fromSide: sides.from }),
        ...(sides.to === undefined ? {} : { toSide: sides.to }),
      },
    ];
    const arrow = `${from}→${to}`;
    const style = rememberedArrow(this.remembered.value);
    if (style && !map.relations.some((item) => item.id === arrow))
      ops.push({
        op: "style-arrow",
        view,
        arrow,
        style: { ...style, ...pinnedEnds(map, from, to, sides) },
      });
    await this.edit(ops, map);
  }

  /**
   * Пачка операций. Ожидаемый результат ложится на холст сразу, до ответа. Удалась — номер
   * уходит в стек отмены, а повтор отменённого теряет смысл. Отказ — правка снимается, узел
   * возвращается, причина строкой на холсте; `false` говорит об этом холсту.
   */
  async edit(ops: MapOp[], map: ObjectsMap): Promise<boolean> {
    this.messageState.set(undefined);
    this.busyState.update((busy) => busy + 1);
    const key = (this.next += 1);
    const sent = this.same(map);
    // Отражённые и просроченные уже не нужны — копить их незачем.
    this.pendingState.set([
      ...this.pending.filter(
        (entry) => !this.expired.includes(entry.key) && !reflected(sent, entry),
      ),
      { key, ops, sent },
    ]);
    const result = await this.edits.edit(ops);
    this.answer(key, result.ok);
    return this.settle(result, (id) => {
      this.doneState.update((done) => [...done, id]);
      this.undoneState.set([]);
    });
  }

  async undo(): Promise<void> {
    const id = this.doneState.value.at(-1);
    if (id === undefined) return;
    this.busyState.update((busy) => busy + 1);
    const result = await this.edits.undo(id);
    this.settle(result, () => {
      this.doneState.update((done) => done.slice(0, -1));
      this.undoneState.update((undone) => [...undone, id]);
    });
  }

  async redo(): Promise<void> {
    const id = this.undoneState.value.at(-1);
    if (id === undefined) return;
    this.busyState.update((busy) => busy + 1);
    const result = await this.edits.redo(id);
    this.settle(result, () => {
      this.undoneState.update((undone) => undone.slice(0, -1));
      this.doneState.update((done) => [...done, id]);
    });
  }

  /** Удалить подтверждённое: объект — с папкой и связями, ссылку — со вьюхи, фигуру — с холста. */
  async remove(map: ObjectsMap): Promise<void> {
    const target = this.confirming;
    this.cancel();
    if (!target) return;
    await this.edit([deleteOp(map.view, target)], map);
  }

  /** Ответ плагина: удалась — правка ждёт, пока вьюха её отразит; отказ — снимается сразу. */
  private answer(key: number, ok: boolean): void {
    if (!ok) {
      this.pendingState.update((pending) => pending.filter((entry) => entry.key !== key));
      return;
    }
    setTimeout(() => this.expire(key), PENDING_TTL_MS);
  }

  private expire(key: number): void {
    this.expiredState.update((expired) => [...expired, key]);
  }

  private settle(result: EditResult, apply: (id: string) => void): boolean {
    this.busyState.update((busy) => busy - 1);
    if (!result.ok) {
      this.say(result.error, true);
      return false;
    }
    apply(result.id);
    return true;
  }
}
