import * as T from "typebox";
import type { Static } from "typebox";
import { childAddress, MAP_ROOT } from "./address.ts";
import { findMetricOwner, findObject } from "./model.ts";
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

const Shape = T.Object({
  id: T.String(),
  kind: T.Union([T.Literal("rect"), T.Literal("ellipse"), T.Literal("text")]),
  x: T.Number(),
  y: T.Number(),
  width: T.Optional(T.Number()),
  height: T.Optional(T.Number()),
  text: T.Optional(T.String()),
  color: T.Optional(T.String()),
});

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
  T.Object({ op: T.Literal("delete-object"), object: T.String() }),
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
    op: T.Literal("set-expanded"),
    view: T.String(),
    object: T.String(),
    expanded: T.Boolean(),
  }),
  T.Object({ op: T.Literal("put-shape"), view: T.String(), shape: Shape }),
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
      ...(state.expanded
        ? { expanded: Object.fromEntries(Object.entries(state.expanded).filter(([k]) => keep(k))) }
        : {}),
    }));
  }
}

function nameOf(root: MapObject, address: string | undefined): string | undefined {
  return address === undefined ? undefined : findObject(root, address)?.name;
}

const fail = (error: string): EditPlan => ({ error });

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
      editState(draft, view.statePath, (state) =>
        withPosition(
          seen ? state : { ...state, refs: [...(state.refs ?? []), address] },
          address,
          op.position,
        ),
      );
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
      const folder = basename(object.path);
      const address = childAddress(parent.address, folder);
      if (address !== object.address) {
        if (parent.children.some((child) => basename(child.path) === folder)) {
          return fail(`В ${parent.name} уже есть ${folder}`);
        }
        draft.move(object.path, join(parent.path, folder));
        for (const path of draft.paths()) {
          const text = draft.read(path) ?? "";
          const next = replaceAddress(text, object.address, address);
          if (next !== text) draft.write(path, next);
        }
      }
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

    case "set-expanded": {
      if (!view) return fail("Нужна вьюха");
      editState(draft, view.statePath, (state) => ({
        ...state,
        expanded: { ...state.expanded, [op.object]: op.expanded },
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
