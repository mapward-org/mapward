import * as T from "typebox";
import type { Static } from "typebox";
import { childAddress, MAP_ROOT } from "./address.ts";
import { findMetricOwner, findObject, trail } from "./model.ts";
import type { MapObject } from "./model.ts";
import {
  isRelation,
  matchesAddress,
  objectsMap,
  objectsMapConfig,
  parseViewState,
  prototypeOf,
  styleOf,
  VIEW_STATE,
  viewSpec,
  ArrowStyle,
  ViewShape,
  within,
} from "./objects-map.ts";
import type { ObjectsMapConfig, ViewState } from "./objects-map.ts";
import { INDEX } from "./raw-object.ts";
import { basename, join } from "../lib/path.ts";

/**
 * Правка карты с холста и агентом — решение 0044. Операция — чистая функция: по живой модели и
 * текстам файлов она считает полный список правок или отказ. Пишет сервер, и пишет только
 * тогда, когда посчитано всё: отказ значит, что на диске ничего не тронуто.
 */

const Point = T.Object({ x: T.Number(), y: T.Number() });

/** Операции холста — они же операции агента через MCP, с теми же аргументами. */
export const MapOp = T.Union([
  T.Object({
    op: T.Literal("create-object"),
    view: T.String(),
    name: T.String(),
    /** Адрес прототипа из палитры; не назван — первый из палитры, пустой палитры — без него. */
    prototype: T.Optional(T.String()),
    /** Группа, на которую бросили; не названа — место для новых объектов из конфига вьюхи. */
    parent: T.Optional(T.String()),
    position: T.Optional(Point),
    /** Размер, которым объект нарисовали протяжкой, — у фрейма; нет — размер из стиля. */
    size: T.Optional(T.Object({ width: T.Number(), height: T.Number() })),
  }),
  T.Object({
    op: T.Literal("create-relation"),
    view: T.String(),
    from: T.String(),
    to: T.String(),
    prototype: T.Optional(T.String()),
    name: T.Optional(T.String()),
  }),
  T.Object({
    op: T.Literal("move-object"),
    object: T.String(),
    /** Новый родитель: объект, полка или корень карты. */
    parent: T.String(),
    view: T.Optional(T.String()),
    position: T.Optional(Point),
  }),
  T.Object({
    op: T.Literal("rename"),
    object: T.String(),
    label: T.String(),
    /** Вьюха, чья подпись правится: у неё подписью может быть поле `props`, а не имя. */
    view: T.Optional(T.String()),
  }),
  T.Object({
    op: T.Literal("set-folder"),
    object: T.String(),
    /** Новое имя папки, то есть последний шаг адреса; приводится к виду имени папки. */
    folder: T.String(),
    view: T.Optional(T.String()),
  }),
  T.Object({ op: T.Literal("delete-object"), object: T.String() }),
  T.Object({
    op: T.Literal("copy-objects"),
    view: T.String(),
    /** Что копировать; лежащий внутри другого скопированного едет с ним и отдельно не копируется. */
    objects: T.Array(T.String()),
    /** Куда класть копии; не назван — место для новых объектов из конфига вьюхи. */
    parent: T.Optional(T.String()),
    /** Позиции копий на этой вьюхе по адресам оригиналов — относительно родителя. */
    positions: T.Optional(T.Record(T.String(), Point)),
  }),
  T.Object({
    op: T.Literal("add-ref"),
    view: T.String(),
    object: T.String(),
    position: T.Optional(Point),
  }),
  T.Object({ op: T.Literal("remove-ref"), view: T.String(), object: T.String() }),
  T.Object({
    op: T.Literal("move-nodes"),
    view: T.String(),
    positions: T.Record(T.String(), Point),
  }),
  T.Object({
    op: T.Literal("resize-nodes"),
    view: T.String(),
    sizes: T.Record(
      T.String(),
      T.Object({ width: T.Number(), height: T.Number(), scale: T.Optional(T.Number()) }),
    ),
  }),
  T.Object({
    op: T.Literal("set-bends"),
    view: T.String(),
    /** `id` стрелки из значения вьюхи; пустой список выпрямляет её. */
    arrow: T.String(),
    bends: T.Array(Point),
  }),
  T.Object({
    op: T.Literal("style-arrow"),
    view: T.String(),
    arrow: T.String(),
    /** Поля стиля целиком: так отмена возвращает прежний стиль, а не его кусок. */
    style: ArrowStyle,
  }),
  T.Object({ op: T.Literal("put-shape"), view: T.String(), shape: ViewShape }),
  T.Object({ op: T.Literal("remove-shape"), view: T.String(), id: T.String() }),
]);
export type MapOp = Static<typeof MapOp>;

/**
 * Правка файлов. Папка переносится и удаляется целиком — так её содержимое, которого модель не
 * знает (доки, кэши, директивы), едет вместе с объектом.
 */
export type FileChange =
  | { kind: "write"; path: string; text: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "remove"; path: string };

export type EditPlan = { changes: FileChange[] } | { error: string };

export type EditContext = {
  root: MapObject;
  /**
   * Тексты файлов, где могут стоять адреса: `_index.json` объектов, `config.json` метрик и
   * `map-state.json` вьюх — те, что назвала `editSources`. Нет файла — нет ключа.
   */
  files: ReadonlyMap<string, string>;
};

function walk(object: MapObject, visit: (object: MapObject) => void): void {
  visit(object);
  for (const child of object.children) walk(child, visit);
}

/** Какие файлы операциям нужно прочитать заранее: всё, где карта пишет адреса. */
export function editSources(root: MapObject): string[] {
  const paths = new Set<string>();
  walk(root, (object) => {
    if (!object.isGroup) paths.add(join(object.path, INDEX));
    for (const metric of object.metrics) {
      if (metric.owner === undefined) paths.add(metric.configPath);
      if (viewSpec(metric.config.collectors)) paths.add(join(metric.cachePath, VIEW_STATE));
    }
  });
  return [...paths];
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Имя папки из подписи: буквы и цифры любого алфавита, остальное — дефисом. */
export function slug(name: string): string {
  const folder = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "");
  return folder || "объект";
}

/**
 * Черновик правки: тексты с наложенными записями и список переносов. Перенос двигает и ключи
 * черновика — файл внутри перенесённой папки дальше пишется по новому пути.
 */
class Draft {
  private readonly texts: Map<string, string>;
  private readonly written = new Set<string>();
  private readonly moves: FileChange[] = [];
  private readonly removed: string[] = [];

  constructor(files: ReadonlyMap<string, string>) {
    this.texts = new Map(files);
  }

  read(path: string): string | undefined {
    return this.texts.get(path);
  }

  write(path: string, text: string): void {
    if (this.texts.get(path) === text && !this.written.has(path)) return;
    this.texts.set(path, text);
    this.written.add(path);
  }

  paths(): string[] {
    return [...this.texts.keys()];
  }

  move(from: string, to: string): void {
    this.moves.push({ kind: "move", from, to });
    const shift = (path: string) =>
      path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
    // Копия, а не сам словарь: ключи в нём переставляются по ходу.
    for (const [path, text] of Array.from(this.texts)) {
      const next = shift(path);
      if (next === path) continue;
      this.texts.delete(path);
      this.texts.set(next, text);
      if (this.written.delete(path)) this.written.add(next);
    }
  }

  remove(path: string): void {
    this.removed.push(path);
    for (const known of Array.from(this.texts.keys())) {
      if (known === path || known.startsWith(`${path}/`)) {
        this.texts.delete(known);
        this.written.delete(known);
      }
    }
  }

  /** Переносы, потом удаления, потом записи — записи уже по путям после переноса. */
  changes(): FileChange[] {
    return [
      ...this.moves,
      ...this.removed.map((path): FileChange => ({ kind: "remove", path })),
      ...[...this.written].map((path): FileChange => ({
        kind: "write",
        path,
        text: this.texts.get(path) ?? "",
      })),
    ];
  }
}

type View = { config: ObjectsMapConfig; statePath: string };

function viewOf(root: MapObject, address: string): View | string {
  const found = findMetricOwner(root, address);
  if (!found) return `Вьюхи ${address} нет`;
  const spec = viewSpec(found.metric.config.collectors);
  if (!spec) return `Метрика ${address} — не вьюха: у неё нет коллектора objects-map`;
  return { config: objectsMapConfig(spec), statePath: join(found.metric.cachePath, VIEW_STATE) };
}

function editState(draft: Draft, path: string, change: (state: ViewState) => ViewState): void {
  draft.write(path, json(change(parseViewState(draft.read(path)))));
}

const withPosition = (
  state: ViewState,
  address: string,
  position: { x: number; y: number } | undefined,
): ViewState =>
  position === undefined
    ? state
    : { ...state, positions: { ...state.positions, [address]: position } };

/** Адрес как отдельное слово: `mapward://a` не задевает `mapward://ab`. */
function replaceAddress(text: string, from: string, to: string): string {
  const escaped = from.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replaceAll(new RegExp(`${escaped}(?![\\p{L}\\p{N}_.-])`, "gu"), to);
}

/**
 * Несколько адресов за один проход: адрес, уже заменённый на новый, не задевается следующей
 * заменой, даже если новый начинается с другого старого.
 */
function replaceAddresses(text: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0) return text;
  const olds = [...renames.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map((address) => address.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:${olds.join("|")})(?![\\p{L}\\p{N}_.-])`, "gu");
  return text.replaceAll(pattern, (found) => renames.get(found) ?? found);
}

/** Адрес внутри скопированного — под адресом копии; вне копии — `undefined`. */
function copiedAddress(address: string, renames: ReadonlyMap<string, string>): string | undefined {
  for (const [from, to] of renames) {
    if (within(address, from)) return to + address.slice(from.length);
  }
  return undefined;
}

/** Записи под ключами копий рядом с записями оригиналов. */
function copyKeys<T>(record: Record<string, T>, key: (id: string) => string): Record<string, T> {
  const next = { ...record };
  for (const [id, value] of Object.entries(record)) {
    const moved = key(id);
    if (moved !== id) next[moved] = value;
  }
  return next;
}

function freeName(parent: MapObject, wanted: string): string {
  const taken = new Set(parent.children.map((child) => basename(child.path)));
  if (!taken.has(wanted)) return wanted;
  for (let index = 2; ; index += 1) {
    const name = `${wanted}-${index}`;
    if (!taken.has(name)) return name;
  }
}

function readIndex(draft: Draft, object: MapObject): Record<string, unknown> {
  const raw = draft.read(join(object.path, INDEX));
  if (raw === undefined) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Все вьюхи, чьё состояние знает контекст, — удалённый объект убирается из каждой. */
const statePaths = (draft: Draft) => draft.paths().filter((path) => basename(path) === VIEW_STATE);

function forget(draft: Draft, address: string): void {
  const keep = (key: string) => !within(key, address);
  for (const path of statePaths(draft)) {
    editState(draft, path, (state) => ({
      ...state,
      ...(state.refs ? { refs: state.refs.filter(keep) } : {}),
      ...(state.positions
        ? {
            positions: Object.fromEntries(Object.entries(state.positions).filter(([k]) => keep(k))),
          }
        : {}),
      ...(state.sizes
        ? { sizes: Object.fromEntries(Object.entries(state.sizes).filter(([k]) => keep(k))) }
        : {}),
    }));
  }
}

function nameOf(root: MapObject, address: string | undefined): string | undefined {
  return address === undefined ? undefined : findObject(root, address)?.name;
}

const fail = (error: string): EditPlan => ({ error });

/**
 * Перенос папки под нового родителя и, может быть, под новым именем — общее у переноса и смены
 * адреса. Переписывает адрес объекта и его потомков во всех файлах контекста; тексты директив в
 * контекст не входят и не трогаются (решение 0044). Отдаёт новый адрес или отказ.
 */
function relocate(
  draft: Draft,
  object: MapObject,
  parent: MapObject,
  folder: string,
): string | EditPlan {
  const address = childAddress(parent.address, folder);
  if (address === object.address) return address;
  if (parent.children.some((child) => child !== object && basename(child.path) === folder)) {
    return fail(`В ${parent.name} уже есть ${folder}`);
  }
  draft.move(object.path, join(parent.path, folder));
  for (const path of draft.paths()) {
    const text = draft.read(path) ?? "";
    const next = replaceAddress(text, object.address, address);
    if (next !== text) draft.write(path, next);
  }
  return address;
}

/** Одна операция — полный список правок или отказ с причиной. */
export function planEdit(context: EditContext, op: MapOp): EditPlan {
  const { root } = context;
  const draft = new Draft(context.files);
  const view = "view" in op && op.view !== undefined ? viewOf(root, op.view) : undefined;
  if (typeof view === "string") return fail(view);

  switch (op.op) {
    case "create-object": {
      if (!view) return fail("Нужна вьюха");
      const place = op.parent ?? view.config.placeObjects;
      if (place === undefined) {
        return fail(
          "Место для новых объектов в настройке вьюхи не названо: создавать можно только в группе",
        );
      }
      const parent = findObject(root, place);
      if (!parent) return fail(`Нет объекта ${place}, куда класть новый`);
      const name = op.name.trim();
      if (!name) return fail("У объекта нет имени");
      const prototype = op.prototype ?? view.config.palette.objects[0];
      if (prototype !== undefined && !findObject(root, prototype)) {
        return fail(`Нет прототипа ${prototype}`);
      }
      const folder = freeName(parent, slug(name));
      const address = childAddress(parent.address, folder);
      draft.write(
        join(parent.path, folder, INDEX),
        json({ name, ...(prototype === undefined ? {} : { extends: prototype }) }),
      );
      // Брошенное на пустое место, но вьюхой не выбранное, пропало бы с холста сразу после
      // создания: такое встаёт ссылкой.
      const prototypeName = nameOf(root, prototype);
      const seen =
        op.parent !== undefined ||
        view.config.show.some((pattern) => matchesAddress(address, pattern)) ||
        view.config.prototypes.some((key) => key === prototype || key === prototypeName);
      editState(draft, view.statePath, (state) => {
        const placed = withPosition(
          seen ? state : { ...state, refs: [...(state.refs ?? []), address] },
          address,
          op.position,
        );
        // Адрес знает только сервер — имя папки может занять сосед, — поэтому и размер пишет он.
        return op.size ? { ...placed, sizes: { ...placed.sizes, [address]: op.size } } : placed;
      });
      return { changes: draft.changes() };
    }

    case "create-relation": {
      if (!view) return fail("Нужна вьюха");
      const place = view.config.placeRelations;
      if (place === undefined) return fail("Место для новых связей в настройке вьюхи не названо");
      const parent = findObject(root, place);
      if (!parent) return fail(`Нет объекта ${place}, куда класть связь`);
      if (!findObject(root, op.from)) return fail(`Нет объекта ${op.from}`);
      if (!findObject(root, op.to)) return fail(`Нет объекта ${op.to}`);
      if (op.from === op.to) return fail("Связь с самим собой не проводится");
      const prototype = op.prototype ?? view.config.palette.relations[0];
      if (prototype !== undefined && !findObject(root, prototype)) {
        return fail(`Нет прототипа ${prototype}`);
      }
      const end = (address: string) => slug(address.split("/").at(-1) || "корень");
      const folder = freeName(parent, `${end(op.from)}-to-${end(op.to)}`);
      const name = op.name?.trim() || nameOf(root, prototype) || "связь";
      draft.write(
        join(parent.path, folder, INDEX),
        json({
          name,
          ...(prototype === undefined ? {} : { extends: prototype }),
          props: { from: op.from, to: op.to },
        }),
      );
      return { changes: draft.changes() };
    }

    case "move-object": {
      const object = findObject(root, op.object);
      if (!object || object.address === MAP_ROOT) return fail(`Нет объекта ${op.object}`);
      const parent = findObject(root, op.parent);
      if (!parent) return fail(`Нет объекта ${op.parent}, куда переносить`);
      if (within(parent.address, object.address)) {
        return fail("Объект нельзя перенести внутрь самого себя");
      }
      const moved = relocate(draft, object, parent, basename(object.path));
      if (typeof moved !== "string") return moved;
      const address = moved;
      if (view) {
        // Вынесенный на холст, но вьюхой не выбранный, пропал бы с неё сразу после переноса:
        // такой встаёт ссылкой. В видимую развёрнутую группу он попадает жильцом и так.
        const statePath = view.statePath;
        const before = parseViewState(context.files.get(statePath));
        const inGroup = objectsMap(root, op.view ?? "", view.config, before).nodes.some(
          (node) => node.id === parent.address && node.expanded,
        );
        const seen =
          inGroup ||
          view.config.show.some((pattern) => matchesAddress(address, pattern)) ||
          view.config.prototypes.some(
            (key) => key === prototypeOf(object) || key === object.prototypeName,
          );
        editState(draft, statePath, (state) =>
          withPosition(
            seen || state.refs?.includes(address)
              ? state
              : { ...state, refs: [...(state.refs ?? []), address] },
            address,
            op.position,
          ),
        );
      }
      return { changes: draft.changes() };
    }

    case "set-folder": {
      const object = findObject(root, op.object);
      if (!object || object.address === MAP_ROOT || object.isGroup) {
        return fail(`Нет объекта ${op.object}`);
      }
      const chain = trail(root, object.address);
      const parent = chain.at(-2);
      if (!parent) return fail(`Нет родителя у ${op.object}`);
      const moved = relocate(draft, object, parent, slug(op.folder));
      return typeof moved === "string" ? { changes: draft.changes() } : moved;
    }

    case "rename": {
      const object = findObject(root, op.object);
      if (!object || object.isGroup) return fail(`Нет объекта ${op.object}`);
      const label = op.label.trim();
      if (!label) return fail("Пустая подпись");
      const field = view ? styleOf(object, view.config).label : undefined;
      const index = readIndex(draft, object);
      const props = (index.props ?? {}) as Record<string, unknown>;
      // Папка не переименовывается: адрес объекта стоит в связях и директивах.
      const next =
        field && field !== "name"
          ? { ...index, props: { ...props, [field]: label } }
          : { ...index, name: label };
      draft.write(join(object.path, INDEX), json(next));
      return { changes: draft.changes() };
    }

    case "delete-object": {
      const object = findObject(root, op.object);
      if (!object || object.address === MAP_ROOT || object.isGroup) {
        return fail(`Нет объекта ${op.object}`);
      }
      // Связи, у которых удалённый объект концом, без него ничего не значат.
      const hanging: MapObject[] = [];
      walk(root, (candidate) => {
        if (!isRelation(candidate) || within(candidate.address, object.address)) return;
        const { from, to } = candidate.props as { from: string; to: string };
        if (within(from, object.address) || within(to, object.address)) hanging.push(candidate);
      });
      draft.remove(object.path);
      for (const relation of hanging) draft.remove(relation.path);
      forget(draft, object.address);
      for (const relation of hanging) forget(draft, relation.address);
      return { changes: draft.changes() };
    }

    case "copy-objects": {
      if (!view) return fail("Нужна вьюха");
      const place = op.parent ?? view.config.placeObjects;
      if (place === undefined) {
        return fail(
          "Место для новых объектов в настройке вьюхи не названо: вставлять можно только в группу",
        );
      }
      const parent = findObject(root, place);
      if (!parent) return fail(`Нет объекта ${place}, куда вставлять`);
      const originals: MapObject[] = [];
      for (const address of new Set(op.objects)) {
        const object = findObject(root, address);
        // В буфере адреса, а не снимок: удалённый после копирования оригинал вставить нечем.
        if (!object || object.address === MAP_ROOT || object.isGroup) {
          return fail(`Нет объекта ${address}: его удалили или перенесли после копирования`);
        }
        originals.push(object);
      }
      const tops = originals.filter(
        (object) =>
          !originals.some((other) => other !== object && within(object.address, other.address)),
      );
      if (tops.length === 0) return fail("Копировать нечего");

      // Имена папок, занятые у каждого родителя, — с учётом копий, уже положенных этой операцией.
      const taken = new Map<string, Set<string>>();
      const claim = (owner: MapObject, wanted: string): string => {
        const names =
          taken.get(owner.path) ?? new Set(owner.children.map((child) => basename(child.path)));
        taken.set(owner.path, names);
        let name = wanted;
        for (let index = 2; names.has(name); index += 1) name = `${wanted}-${index}`;
        names.add(name);
        return name;
      };
      const renames = new Map<string, string>();
      const folders = new Map<string, string>();
      for (const object of tops) {
        const folder = claim(parent, basename(object.path));
        renames.set(object.address, childAddress(parent.address, folder));
        folders.set(object.path, join(parent.path, folder));
      }

      // Связь копируется, только когда оба её конца попали в копию. Лежащая внутри скопированного,
      // но с концом снаружи, остаётся у оригинала; лежащая снаружи с обоими концами внутри —
      // копируется рядом с собой.
      const copied = (address: string) => copiedAddress(address, renames) !== undefined;
      const skipped: string[] = [];
      const outside: MapObject[] = [];
      walk(root, (candidate) => {
        if (!isRelation(candidate)) return;
        const { from, to } = candidate.props as { from: string; to: string };
        const both = copied(from) && copied(to);
        if (copied(candidate.address)) {
          if (!both) skipped.push(candidate.path);
        } else if (both) outside.push(candidate);
      });
      for (const relation of outside) {
        const shelf = trail(root, relation.address).at(-2);
        if (!shelf) continue;
        const folder = claim(shelf, basename(relation.path));
        renames.set(relation.address, childAddress(shelf.address, folder));
        folders.set(relation.path, join(shelf.path, folder));
      }

      // Копируется то, где карта пишет содержание: `_index.json`, конфиги своих метрик и
      // состояние вьюх. Директивы, их состояние и кэши в контекст не входят и остаются у оригинала.
      const known = [...context.files.keys()];
      const dropped = (path: string) => skipped.some((cut) => within(path, cut));
      for (const [from, to] of folders) {
        for (const path of known) {
          if (!within(path, from) || dropped(path)) continue;
          draft.write(
            to + path.slice(from.length),
            replaceAddresses(context.files.get(path) ?? "", renames),
          );
        }
      }

      // Во вьюхах копия встаёт так же, как оригинал: позиции и размеры потомков, изломы и стили
      // стрелок внутри копии.
      const node = (id: string) => copiedAddress(id, renames) ?? id;
      const arrow = (id: string) => {
        const ends = id.split("→");
        const next = ends.map((end) => copiedAddress(end, renames));
        return ends.length === 2 && next.every((end) => end !== undefined) ? next.join("→") : id;
      };
      for (const path of known) {
        if (basename(path) !== VIEW_STATE) continue;
        editState(draft, path, (state) => ({
          ...state,
          ...(state.positions ? { positions: copyKeys(state.positions, node) } : {}),
          ...(state.sizes ? { sizes: copyKeys(state.sizes, node) } : {}),
          ...(state.bends ? { bends: copyKeys(state.bends, arrow) } : {}),
          ...(state.arrows ? { arrows: copyKeys(state.arrows, arrow) } : {}),
        }));
      }

      // На своей вьюхе копия встаёт, где сказано, а не сказано — чуть в стороне от оригинала.
      // Вьюхой не выбранная пропала бы с холста сразу после вставки: такая встаёт ссылкой.
      const before = parseViewState(context.files.get(view.statePath));
      const inGroup = objectsMap(root, op.view, view.config, before).nodes.some(
        (item) => item.id === parent.address && item.expanded,
      );
      editState(draft, view.statePath, (state) => {
        let next = state;
        for (const object of tops) {
          const address = renames.get(object.address) ?? object.address;
          const at = op.positions?.[object.address];
          const near = before.positions?.[object.address];
          next = withPosition(
            next,
            address,
            at ?? (near === undefined ? undefined : { x: near.x + 24, y: near.y + 24 }),
          );
          const seen =
            inGroup ||
            view.config.show.some((pattern) => matchesAddress(address, pattern)) ||
            view.config.prototypes.some(
              (key) => key === prototypeOf(object) || key === object.prototypeName,
            );
          if (!seen && !next.refs?.includes(address)) {
            next = { ...next, refs: [...(next.refs ?? []), address] };
          }
        }
        return next;
      });
      return { changes: draft.changes() };
    }

    case "add-ref": {
      if (!view) return fail("Нужна вьюха");
      if (!findObject(root, op.object)) return fail(`Нет объекта ${op.object}`);
      editState(draft, view.statePath, (state) =>
        withPosition(
          state.refs?.includes(op.object)
            ? state
            : { ...state, refs: [...(state.refs ?? []), op.object] },
          op.object,
          op.position,
        ),
      );
      return { changes: draft.changes() };
    }

    case "remove-ref": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => ({
        ...state,
        refs: (state.refs ?? []).filter((ref) => ref !== op.object),
      }));
      return { changes: draft.changes() };
    }

    case "move-nodes": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => ({
        ...state,
        positions: { ...state.positions, ...op.positions },
      }));
      return { changes: draft.changes() };
    }

    case "resize-nodes": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => ({
        ...state,
        sizes: { ...state.sizes, ...op.sizes },
      }));
      return { changes: draft.changes() };
    }

    case "set-bends": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => {
        const bends = { ...state.bends };
        if (op.bends.length === 0) delete bends[op.arrow];
        else bends[op.arrow] = op.bends;
        return { ...state, bends };
      });
      return { changes: draft.changes() };
    }

    case "style-arrow": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => ({
        ...state,
        arrows: { ...state.arrows, [op.arrow]: op.style },
      }));
      return { changes: draft.changes() };
    }

    case "put-shape": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => {
        const shapes = state.shapes ?? [];
        const known = shapes.some((shape) => shape.id === op.shape.id);
        return {
          ...state,
          shapes: known
            ? shapes.map((shape) => (shape.id === op.shape.id ? op.shape : shape))
            : [...shapes, op.shape],
        };
      });
      return { changes: draft.changes() };
    }

    case "remove-shape": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => ({
        ...state,
        shapes: (state.shapes ?? []).filter((shape) => shape.id !== op.id),
      }));
      return { changes: draft.changes() };
    }
  }
}
