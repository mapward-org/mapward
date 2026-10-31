import type { MapEditOp, MapEditResult, MapObject } from "@mapward/plugin";
import { findObject, MAP_ROOT, slug, trail, walk } from "./map.ts";
import type { MapOp } from "./ops.ts";
import type { ArrowStyle, ObjectsMap, Side, ViewShape } from "./types.ts";
import {
  findView,
  isRelation,
  matchesAddress,
  objectsMap,
  parseViewState,
  prototypeOf,
  styleOf,
  VIEW_STATE,
  within,
} from "./view.ts";
import type { FoundView, IsView, ViewCopy, ViewState } from "./view.ts";

/**
 * Операция холста — решение 0044 — в два шага. Где она меняет саму карту (создать объект,
 * перенести, удалить, скопировать), это правка платформы: план называет её операции
 * (`ops` для `ctx.editMap`), и адреса в файлах карты при переносе переписывает платформа. Своё
 * у холста — `map-state.json` вьюх: позиции, размеры, ссылки, копии, пометки, изгибы и стили
 * стрелок; его план дописывает вторым шагом (`finish`) по ответу платформы — новым адресам и
 * переездам. Связь — понятие холста, а не карты: объект, у которого в `props` строками стоят
 * `from` и `to`.
 *
 * Функции чистые: снимок карты и тексты `map-state.json` на входе, операции и новые тексты на
 * выходе. Пишет процесс плагина.
 */

/** Что ответила правка карты: новые объекты, переезды и копии. */
export type MapDone = Pick<Extract<MapEditResult, { ok: true }>, "created" | "moves" | "copies">;

export const NOTHING: MapDone = { created: [], moves: [], copies: [] };

export type CanvasPlan =
  | {
      /** Правка карты платформой; пусто — операция трогает только `map-state.json`. */
      ops: MapEditOp[];
      /** Новые тексты `map-state.json` по ответу правки карты — по путям после переездов. */
      finish(done: MapDone): Map<string, string>;
    }
  | { error: string };

export type EditContext = {
  root: MapObject;
  /** Какие метрики карты — вьюхи: их `params` — конфиг, а рядом лежит `map-state.json`. */
  isView: IsView;
  /** Тексты, что назвала `editSources`: `map-state.json` вьюх и индекс подписываемого. */
  files: ReadonlyMap<string, string>;
  /**
   * Где концы новой стрелки касаются узлов. Это знает холст — по раскладке, которой он рисует, —
   * поэтому функцию даёт процесс плагина из `canvas/layout.ts`. Нет её — стрелка рождается с
   * плавающими концами.
   */
  pin?: PinEnds;
};

/**
 * Закрепление концов новой стрелки между узлами вьюхи: названная сторона — как есть, не
 * названная — на усмотрение холста. Узла нет на вьюхе — `undefined`.
 */
export type PinEnds = (
  map: Pick<ObjectsMap, "nodes">,
  from: string,
  to: string,
  sides: { from?: Side | undefined; to?: Side | undefined },
) => Pick<ArrowStyle, "fromAnchor" | "toAnchor"> | undefined;

const basename = (path: string) => path.split("/").at(-1) ?? "";

/** `_index.json` объекта — его свои поля, как написаны. */
const indexOf = (object: MapObject) => `${object.path}/_index.json`;

/** Индекс из текста; не читается — пустой: `set` проверит схемой то, что получится. */
function parseIndex(text: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text ?? "{}");
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Какие файлы холсту нужно прочитать заранее: состояние всех вьюх карты, а подписи — ещё и
 * индекс подписываемого: подпись пишется в него целиком.
 */
export function editSources(root: MapObject, isView: IsView, op?: MapOp): string[] {
  const paths = new Set<string>();
  walk(root, (object) => {
    for (const metric of object.metrics) {
      if (isView(metric)) paths.add(`${metric.cachePath}/${VIEW_STATE}`);
    }
  });
  if (op?.op === "rename") {
    const object = findObject(root, op.object);
    if (object && !object.isGroup) paths.add(indexOf(object));
  }
  return [...paths];
}

/**
 * Несколько адресов за один проход, как отдельные слова: `mapward://a` не задевает
 * `mapward://ab`, а адрес, уже заменённый на новый, не задевается следующей заменой. В состоянии
 * вьюхи адрес бывает частью ключа — `a→b` у стрелки, `адрес#2` у копии, — поэтому заменяется он в
 * тексте, а не по значениям.
 */
export function replaceAddresses(text: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0) return text;
  const olds = [...renames.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map((address) => address.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:${olds.join("|")})(?![\\p{L}\\p{N}_.-])`, "gu");
  return text.replaceAll(pattern, (found) => renames.get(found) ?? found);
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Папка объекта по адресу: адрес — это имена папок от корня карты. */
const folderOf = (root: MapObject, address: string) =>
  address === MAP_ROOT ? root.path : `${root.path}/${address.slice(MAP_ROOT.length)}`;

/** Путь после переездов: файл в перенесённой папке лежит теперь в новой. */
function shiftPath(root: MapObject, path: string, moves: MapDone["moves"]): string {
  let best: { from: string; to: string } | undefined;
  for (const move of moves) {
    const from = folderOf(root, move.from);
    if ((path === from || path.startsWith(`${from}/`)) && from.length > (best?.from.length ?? -1)) {
      best = { from, to: folderOf(root, move.to) };
    }
  }
  return best ? best.to + path.slice(best.from.length) : path;
}

/**
 * Состояние вьюх после правки карты: тексты по путям после переездов, с адресами, переписанными
 * по ним же, и свои записи сверху. Пишется только тронутое.
 */
class States {
  private readonly texts = new Map<string, string>();
  private readonly written = new Set<string>();

  constructor(root: MapObject, files: ReadonlyMap<string, string>, moves: MapDone["moves"]) {
    const renames = new Map(moves.map((move) => [move.from, move.to]));
    for (const [path, text] of files) {
      const next = replaceAddresses(text, renames);
      const at = shiftPath(root, path, moves);
      this.texts.set(at, next);
      if (next !== text) this.written.add(at);
    }
  }

  read(path: string): string | undefined {
    return this.texts.get(path);
  }

  write(path: string, text: string): void {
    if (this.texts.get(path) === text) return;
    this.texts.set(path, text);
    this.written.add(path);
  }

  paths(): string[] {
    return [...this.texts.keys()];
  }

  edit(path: string, change: (state: ViewState) => ViewState): void {
    this.write(path, json(change(parseViewState(this.read(path)))));
  }

  result(): Map<string, string> {
    return new Map([...this.written].map((path) => [path, this.texts.get(path) ?? ""]));
  }
}

const withPosition = (
  state: ViewState,
  address: string,
  position: { x: number; y: number } | undefined,
): ViewState =>
  position === undefined
    ? state
    : { ...state, positions: { ...state.positions, [address]: position } };

/** Адрес внутри скопированного — под адресом копии; вне копии — `undefined`. */
function copiedAddress(address: string, renames: ReadonlyMap<string, string>): string | undefined {
  let best: string | undefined;
  for (const from of renames.keys()) {
    if (within(address, from) && from.length > (best?.length ?? -1)) best = from;
  }
  return best === undefined ? undefined : (renames.get(best) ?? best) + address.slice(best.length);
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

/**
 * Пометки скопированных групп — копиями на копиях групп, рядом с оригиналами. Номер копии —
 * номер оригинала со свободным суффиксом: пометки вьюхи различаются номером.
 */
function copyShapes(shapes: ViewShape[], renames: ReadonlyMap<string, string>): ViewShape[] {
  const taken = new Set(shapes.map((shape) => shape.id));
  const copies: ViewShape[] = [];
  for (const shape of shapes) {
    const parent = shape.parent === undefined ? undefined : copiedAddress(shape.parent, renames);
    if (parent === undefined) continue;
    let id = `${shape.id}-2`;
    for (let index = 3; taken.has(id); index += 1) id = `${shape.id}-${index}`;
    taken.add(id);
    copies.push({ ...shape, id, parent });
  }
  return [...shapes, ...copies];
}

/** Конец связи в имени её папки: последний шаг адреса. */
const endName = (address: string) => slug(address.split("/").at(-1) || "корень");

/** Объект копии по её `id`: всё до последнего `#`. */
const copyObject = (id: string): string => id.slice(0, Math.max(0, id.lastIndexOf("#")));

/** Отдельный от удаления шаг: из записей состояния — всё, что лежит внутри адреса. */
const without = <T>(record: Record<string, T>, keep: (key: string) => boolean) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => keep(key)));

/** Удалённый объект уходит из всех вьюх: ссылки, позиции, размеры, копии, пометки на нём. */
function forget(states: States, address: string): void {
  // Копия удалённого объекта уходит с ним, ключи её позиции и размера — тоже.
  const keep = (key: string) => !within(key, address) && !within(copyObject(key), address);
  for (const path of states.paths()) {
    if (basename(path) !== VIEW_STATE) continue;
    states.edit(path, (state) => ({
      ...state,
      ...(state.copies
        ? {
            copies: Object.fromEntries(
              Object.entries(state.copies)
                .filter(([id]) => keep(id))
                // Копия удалённого фрейма не пропадает: ложится на холст.
                .map(([id, copy]): [string, ViewCopy] => {
                  if (copy.parent === undefined || keep(copy.parent)) return [id, copy];
                  const { parent: _gone, ...rest } = copy;
                  return [id, rest];
                }),
            ),
          }
        : {}),
      ...(state.ends ? { ends: without(state.ends, keep) } : {}),
      ...(state.refs ? { refs: state.refs.filter(keep) } : {}),
      ...(state.positions ? { positions: without(state.positions, keep) } : {}),
      ...(state.sizes ? { sizes: without(state.sizes, keep) } : {}),
      // Пометка, нарисованная на удалённой группе, без неё ничего не значит.
      ...(state.shapes
        ? {
            shapes: state.shapes.filter(
              (shape) => shape.parent === undefined || keep(shape.parent),
            ),
          }
        : {}),
    }));
  }
}

function nameOf(root: MapObject, address: string | undefined): string | undefined {
  return address === undefined ? undefined : findObject(root, address)?.name;
}

const fail = (error: string): CanvasPlan => ({ error });

/** Одна операция холста — правка карты и что дописать в состояние вьюх, или отказ. */
export function planEdit(context: EditContext, op: MapOp): CanvasPlan {
  const { root } = context;
  const view: FoundView | string | undefined =
    "view" in op && op.view !== undefined ? findView(root, op.view, context.isView) : undefined;
  if (typeof view === "string") return fail(view);
  /** Вторым шагом — только состояние вьюх, по тому, что ответила правка карты. */
  const plan = (ops: MapEditOp[], finish: (states: States, done: MapDone) => void): CanvasPlan => ({
    ops,
    finish: (done) => {
      const states = new States(root, context.files, done.moves);
      finish(states, done);
      return states.result();
    },
  });
  /** Путь состояния вьюхи после переездов. */
  const stateAt = (found: FoundView, done: MapDone) => shiftPath(root, found.statePath, done.moves);

  switch (op.op) {
    case "create-object": {
      if (!view) return fail("Нужна вьюха");
      const place = op.parent ?? view.config.placeObjects;
      if (place === undefined) {
        return fail(
          "Место для новых объектов в настройке вьюхи не названо: создавать можно только в группе",
        );
      }
      const prototype = op.prototype ?? view.config.palette.objects[0];
      return plan(
        [
          {
            op: "create",
            parent: place,
            content: {
              name: op.name,
              ...(prototype === undefined ? {} : { extends: prototype }),
            },
          },
        ],
        (states, done) => {
          const address = done.created[0];
          if (address === undefined) return;
          // Брошенное на пустое место, но вьюхой не выбранное, пропало бы с холста сразу после
          // создания: такое встаёт ссылкой.
          const prototypeName = nameOf(root, prototype);
          const seen =
            op.parent !== undefined ||
            view.config.show.some((pattern) => matchesAddress(address, pattern)) ||
            view.config.prototypes.some((key) => key === prototype || key === prototypeName);
          states.edit(stateAt(view, done), (state) => {
            const placed = withPosition(
              seen ? state : { ...state, refs: [...(state.refs ?? []), address] },
              address,
              op.position,
            );
            // Адрес знает только платформа — имя папки может занять сосед, — поэтому и размер
            // пишется после её ответа.
            return op.size ? { ...placed, sizes: { ...placed.sizes, [address]: op.size } } : placed;
          });
        },
      );
    }

    case "create-relation": {
      if (!view) return fail("Нужна вьюха");
      const place = view.config.placeRelations;
      if (place === undefined) return fail("Место для новых связей в настройке вьюхи не названо");
      if (!findObject(root, place)) return fail(`Нет объекта ${place}, куда класть связь`);
      // Конец связи — объект или копия на этой вьюхе: копия даёт связи адрес своего объекта, а
      // себе — привязку, по которой стрелка придёт именно к ней.
      const copies = parseViewState(context.files.get(view.statePath)).copies ?? {};
      const endOf = (id: string) => copies[id]?.object ?? id;
      const from = endOf(op.from);
      const to = endOf(op.to);
      if (!findObject(root, from)) return fail(`Нет объекта ${op.from}`);
      if (!findObject(root, to)) return fail(`Нет объекта ${op.to}`);
      if (from === to) return fail("Связь с самим собой не проводится");
      const prototype = op.prototype ?? view.config.palette.relations[0];
      if (prototype !== undefined && !findObject(root, prototype)) {
        return fail(`Нет прототипа ${prototype}`);
      }
      // Связь — объект карты с концами в `props`: стрелкой его делает холст, а не карта.
      return plan(
        [
          {
            op: "create",
            parent: place,
            folder: `${endName(from)}-to-${endName(to)}`,
            content: {
              name: op.name?.trim() || nameOf(root, prototype) || "связь",
              ...(prototype === undefined ? {} : { extends: prototype }),
              props: { from, to },
            },
          },
        ],
        (states, done) => {
          const statePath = stateAt(view, done);
          const bound = {
            ...(copies[op.from] ? { from: op.from } : {}),
            ...(copies[op.to] ? { to: op.to } : {}),
          };
          const address = done.created[0];
          if (Object.keys(bound).length > 0 && address !== undefined) {
            states.edit(statePath, (state) => ({
              ...state,
              ends: { ...state.ends, [address]: bound },
            }));
          }
          // Новая стрелка рождается закреплённой. Концы — узлы, которые видны, как у стрелки на
          // холсте; связь, влившаяся в уже нарисованную стрелку той же пары, её концы не
          // перекладывает.
          const shown = objectsMap(
            root,
            op.view,
            view.config,
            parseViewState(states.read(statePath)),
          );
          const ids = shown.nodes
            .map((node) => node.id)
            .filter((id) => !copies[id])
            .toSorted((a, b) => b.length - a.length);
          const visible = (id: string, end: string) =>
            copies[id] ? id : ids.find((node) => within(end, node));
          const a = visible(op.from, from);
          const b = visible(op.to, to);
          const arrow = `${a}→${b}`;
          const fresh = !shown.relations.some((item) => item.id === arrow);
          const ends =
            a &&
            b &&
            a !== b &&
            fresh &&
            context.pin?.(shown, a, b, { from: op.fromSide, to: op.toSide });
          if (ends) {
            states.edit(statePath, (state) => ({
              ...state,
              arrows: { ...state.arrows, [arrow]: { ...state.arrows?.[arrow], ...ends } },
            }));
          }
        },
      );
    }

    case "move-object": {
      const object = findObject(root, op.object);
      if (!object || object.address === MAP_ROOT) return fail(`Нет объекта ${op.object}`);
      const parent = findObject(root, op.parent);
      if (!parent) return fail(`Нет объекта ${op.parent}, куда переносить`);
      return plan([{ op: "move", object: op.object, parent: op.parent }], (states, done) => {
        if (!view) return;
        const address = done.moves.find((move) => move.from === object.address)?.to;
        if (address === undefined) return;
        // Вынесенный на холст, но вьюхой не выбранный, пропал бы с неё сразу после переноса:
        // такой встаёт ссылкой. В видимую развёрнутую группу он попадает жильцом и так.
        const before = parseViewState(context.files.get(view.statePath));
        const inGroup = objectsMap(root, op.view ?? "", view.config, before).nodes.some(
          (node) => node.id === parent.address && node.expanded,
        );
        const seen =
          inGroup ||
          view.config.show.some((pattern) => matchesAddress(address, pattern)) ||
          view.config.prototypes.some(
            (key) => key === prototypeOf(object) || key === object.prototypeName,
          );
        states.edit(stateAt(view, done), (state) =>
          withPosition(
            seen || state.refs?.includes(address)
              ? state
              : { ...state, refs: [...(state.refs ?? []), address] },
            address,
            op.position,
          ),
        );
      });
    }

    case "set-folder":
      return plan([{ op: "setFolder", object: op.object, folder: op.folder }], () => {});

    case "rename": {
      const object = findObject(root, op.object);
      if (!object || object.isGroup) return fail(`Нет объекта ${op.object}`);
      const label = op.label.trim();
      if (!label) return fail("Пустая подпись");
      // Подписью на вьюхе бывает поле `props`, а не имя. Индекс пишется целиком (`set`) — свой,
      // как написан, без наследования: его текст прочитан заранее (`editSources`).
      const field = view ? styleOf(object, view.config).label : undefined;
      const index = parseIndex(context.files.get(indexOf(object)));
      const content =
        field && field !== "name"
          ? { ...index, props: { ...(index.props as object | undefined), [field]: label } }
          : { ...index, name: label };
      return plan([{ op: "set", address: op.object, content }], () => {});
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
      return plan(
        [object, ...hanging].map((gone) => ({ op: "delete", address: gone.address })),
        (states) => {
          forget(states, object.address);
          for (const relation of hanging) forget(states, relation.address);
        },
      );
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

      // Связь копируется, только когда оба её конца попали в копию. Лежащая внутри скопированного,
      // но с концом снаружи, остаётся у оригинала; лежащая снаружи с обоими концами внутри —
      // копируется рядом с собой.
      const copied = (address: string) => tops.some((top) => within(address, top.address));
      const skip: string[] = [];
      const outside: { object: string; parent: string }[] = [];
      walk(root, (candidate) => {
        if (!isRelation(candidate)) return;
        const { from, to } = candidate.props as { from: string; to: string };
        const both = copied(from) && copied(to);
        if (copied(candidate.address)) {
          if (!both) skip.push(candidate.address);
          return;
        }
        const shelf = both ? trail(root, candidate.address).at(-2) : undefined;
        if (shelf) outside.push({ object: candidate.address, parent: shelf.address });
      });

      return plan(
        [
          {
            op: "copy",
            objects: [
              ...tops.map((object) => ({ object: object.address, parent: place })),
              ...outside,
            ],
            ...(skip.length === 0 ? {} : { skip }),
          },
        ],
        (states, done) => {
          const renames = new Map(done.copies.map((copy) => [copy.from, copy.to]));
          // Состояние вьюх внутри скопированного едет с копией: платформа копирует файлы карты, а
          // `map-state.json` — файл холста.
          for (const [path, text] of context.files) {
            const top = tops.find((object) =>
              path.startsWith(`${folderOf(root, object.address)}/`),
            );
            const to = top === undefined ? undefined : renames.get(top.address);
            if (!top || to === undefined) continue;
            const from = folderOf(root, top.address);
            states.write(
              folderOf(root, to) + path.slice(from.length),
              replaceAddresses(text, renames),
            );
          }

          // Во вьюхах копия встаёт так же, как оригинал: позиции и размеры потомков, изломы и
          // стили стрелок внутри копии.
          const node = (id: string) => copiedAddress(id, renames) ?? id;
          const arrow = (id: string) => {
            const ends = id.split("→");
            const next = ends.map((end) => copiedAddress(end, renames));
            return ends.length === 2 && next.every((end) => end !== undefined)
              ? next.join("→")
              : id;
          };
          for (const path of context.files.keys()) {
            states.edit(path, (state) => ({
              ...state,
              ...(state.positions ? { positions: copyKeys(state.positions, node) } : {}),
              ...(state.sizes ? { sizes: copyKeys(state.sizes, node) } : {}),
              ...(state.bends ? { bends: copyKeys(state.bends, arrow) } : {}),
              ...(state.arrows ? { arrows: copyKeys(state.arrows, arrow) } : {}),
              ...(state.shapes ? { shapes: copyShapes(state.shapes, renames) } : {}),
            }));
          }

          // На своей вьюхе копия встаёт, где сказано, а не сказано — чуть в стороне от
          // оригинала. Вьюхой не выбранная пропала бы с холста сразу после вставки: такая встаёт
          // ссылкой.
          const before = parseViewState(context.files.get(view.statePath));
          const inGroup = objectsMap(root, op.view, view.config, before).nodes.some(
            (item) => item.id === parent.address && item.expanded,
          );
          states.edit(view.statePath, (state) => {
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
        },
      );
    }

    case "add-ref": {
      if (!view) return fail("Нужна вьюха");
      if (!findObject(root, op.object)) return fail(`Нет объекта ${op.object}`);
      return plan([], (states) =>
        states.edit(view.statePath, (state) =>
          withPosition(
            state.refs?.includes(op.object)
              ? state
              : { ...state, refs: [...(state.refs ?? []), op.object] },
            op.object,
            op.position,
          ),
        ),
      );
    }

    case "remove-ref": {
      if (!view) return fail("Нужна вьюха");
      return plan([], (states) =>
        states.edit(view.statePath, (state) => ({
          ...state,
          refs: (state.refs ?? []).filter((ref) => ref !== op.object),
        })),
      );
    }

    case "put-copy": {
      if (!view) return fail("Нужна вьюха");
      const state = parseViewState(context.files.get(view.statePath));
      const known = state.copies?.[op.copy];
      const address = known?.object ?? copyObject(op.copy);
      if (!address || op.copy === address) {
        return fail(`${op.copy} — не копия: её id — адрес объекта и номер после #`);
      }
      const object = findObject(root, address);
      if (!object || object.address === MAP_ROOT || object.isGroup || isRelation(object)) {
        return fail(`Нет объекта ${address}`);
      }
      // Копию фрейма не делают: пришлось бы решать, чьи копии у её жильцов.
      const frames = objectsMap(root, op.view, view.config, state).nodes.filter(
        (node) => node.expanded,
      );
      if (!known && frames.some((node) => node.object === address)) {
        return fail("Копию фрейма не делают");
      }
      if (op.parent !== undefined && !frames.some((node) => node.id === op.parent)) {
        return fail(`${op.parent} на этой вьюхе — не фрейм: копию кладут на фрейм или на холст`);
      }
      const copy: ViewCopy = {
        object: address,
        ...(op.parent === undefined ? {} : { parent: op.parent }),
      };
      return plan([], (states) =>
        states.edit(view.statePath, (now) =>
          withPosition(
            { ...now, copies: { ...now.copies, [op.copy]: copy } },
            op.copy,
            op.position,
          ),
        ),
      );
    }

    case "remove-copy": {
      if (!view) return fail("Нужна вьюха");
      const state = parseViewState(context.files.get(view.statePath));
      if (!state.copies?.[op.copy]) return fail(`Копии ${op.copy} на этой вьюхе нет`);
      // Связь, проведённая к копии, без неё ничего не значит: уходит вместе с ней.
      const bound = Object.entries(state.ends ?? {})
        .filter(([, ends]) => ends.from === op.copy || ends.to === op.copy)
        .map(([address]) => findObject(root, address))
        .filter((relation): relation is MapObject => relation !== undefined);
      return plan(
        bound.map((relation) => ({ op: "delete", address: relation.address })),
        (states) => {
          for (const relation of bound) forget(states, relation.address);
          states.edit(view.statePath, (now) => {
            const drop = (key: string) => key !== op.copy;
            return {
              ...now,
              copies: without(now.copies ?? {}, drop),
              ...(now.positions ? { positions: without(now.positions, drop) } : {}),
              ...(now.sizes ? { sizes: without(now.sizes, drop) } : {}),
            };
          });
        },
      );
    }

    case "move-nodes": {
      if (!view) return fail("Нужна вьюха");
      return plan([], (states) =>
        states.edit(view.statePath, (state) => ({
          ...state,
          positions: { ...state.positions, ...op.positions },
        })),
      );
    }

    case "resize-nodes": {
      if (!view) return fail("Нужна вьюха");
      return plan([], (states) =>
        states.edit(view.statePath, (state) => ({
          ...state,
          sizes: { ...state.sizes, ...op.sizes },
        })),
      );
    }

    case "set-bends": {
      if (!view) return fail("Нужна вьюха");
      return plan([], (states) =>
        states.edit(view.statePath, (state) => {
          const bends = { ...state.bends };
          if (op.bends.length === 0) delete bends[op.arrow];
          else bends[op.arrow] = op.bends;
          return { ...state, bends };
        }),
      );
    }

    case "style-arrow": {
      if (!view) return fail("Нужна вьюха");
      return plan([], (states) =>
        states.edit(view.statePath, (state) => ({
          ...state,
          arrows: { ...state.arrows, [op.arrow]: op.style },
        })),
      );
    }

    case "put-shape": {
      if (!view) return fail("Нужна вьюха");
      return plan([], (states) =>
        states.edit(view.statePath, (state) => {
          const shapes = state.shapes ?? [];
          const known = shapes.some((shape) => shape.id === op.shape.id);
          return {
            ...state,
            shapes: known
              ? shapes.map((shape) => (shape.id === op.shape.id ? op.shape : shape))
              : [...shapes, op.shape],
          };
        }),
      );
    }

    case "remove-shape": {
      if (!view) return fail("Нужна вьюха");
      return plan([], (states) =>
        states.edit(view.statePath, (state) => ({
          ...state,
          shapes: (state.shapes ?? []).filter((shape) => shape.id !== op.id),
        })),
      );
    }
  }
}
