import type { MapEditOp, MapObject } from "@mapward/core";
import {
  ACTIONS,
  childAddress,
  CONFIG,
  findObject,
  INDEX,
  MAP_ROOT,
  mapAddress,
  parseAddress,
  METRICS,
  trail,
} from "@mapward/core";
import { basename, join } from "../../../lib/path.ts";

/**
 * Одна операция правки карты — чистая функция: по снимку карты и текстам её файлов она считает
 * полный список файловых правок или отказ. Пишет `EditMap`, и пишет только посчитанное целиком:
 * отказ значит, что на диске ничего не тронуто.
 *
 * Что значат поля объекта, платформа не знает. Перенос поэтому переписывает адрес везде, где он
 * стоит строкой в `_index.json` и `config.json` карты, — так едут и прототипы в `extends`, и
 * концы стрелок холста в `props`, хотя про стрелки здесь ни слова. Свои файлы с адресами (у
 * холста — `map-state.json`) плагин переписывает сам по переездам из ответа; тексты директив не
 * трогаются никогда.
 */

/**
 * Правка файлов. Папка переносится и удаляется целиком — так её содержимое, которого модель не
 * знает (доки, кэши, директивы), едет вместе с объектом.
 */
export type FileChange =
  | { kind: "write"; path: string; text: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "remove"; path: string };

export type Move = { from: string; to: string };

export type EditPlan =
  | {
      changes: FileChange[];
      /** Новый объект. */
      created?: string;
      /** Перенесённые (`move`, `setFolder`) — с потомками. */
      moves: Move[];
      /** Скопированные — с потомками. */
      copies: Move[];
    }
  | { error: string };

export type EditContext = {
  root: MapObject;
  /** Тексты файлов карты — те, что назвала `mapFiles`. Нет файла — нет ключа. */
  files: ReadonlyMap<string, string>;
};

export function walk(object: MapObject, visit: (object: MapObject) => void): void {
  visit(object);
  for (const child of object.children) walk(child, visit);
}

/** Файлы карты, которые правке нужно прочитать заранее: `_index.json` и свои `config.json` слоёв. */
export function mapFiles(root: MapObject): string[] {
  const paths = new Set<string>();
  walk(root, (object) => {
    if (!object.isGroup) paths.add(join(object.path, INDEX));
    for (const layer of [...object.metrics, ...object.actions]) {
      if (layer.owner === undefined) paths.add(layer.configPath);
    }
  });
  return [...paths];
}

/** Имя папки из имени объекта: буквы и цифры любого алфавита, остальное — дефисом. */
export function slug(name: string): string {
  const folder = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "");
  return folder || "объект";
}

/** Лежит ли адрес внутри другого (или это он сам). Корень содержит всё. */
export const within = (inner: string, outer: string): boolean =>
  outer === MAP_ROOT || inner === outer || inner.startsWith(`${outer}/`);

/** Лежит ли путь в папке (или это она сама). */
const inside = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(`${folder}/`);

/**
 * Новый адрес для строки — она сама старый адрес или адрес внутри него (`…/ребёнок`, `…#поле`);
 * иначе `undefined`. Самый длинный старый адрес побеждает.
 */
function renamed(value: string, olds: string[], renames: ReadonlyMap<string, string>) {
  for (const old of olds) {
    if (value === old || value.startsWith(`${old}/`) || value.startsWith(`${old}#`)) {
      return (renames.get(old) ?? old) + value.slice(old.length);
    }
  }
  return undefined;
}

const JSON_STRING = /"(?:[^"\\]|\\.)*"/g;

/**
 * Адреса в json карты — строками, где бы они ни стояли: в полях, во вложенных объектах, в
 * массивах и ключами (`style.objects` вьюхи пишет адреса ключами). Меняются только строки, а не
 * разметка файла — вид, который выбрал человек, остаётся.
 */
export function rewriteJson(text: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0) return text;
  const olds = [...renames.keys()].toSorted((a, b) => b.length - a.length);
  return text.replaceAll(JSON_STRING, (token) => {
    let value: unknown;
    try {
      value = JSON.parse(token);
    } catch {
      return token;
    }
    if (typeof value !== "string") return token;
    const next = renamed(value, olds, renames);
    return next === undefined ? token : JSON.stringify(next);
  });
}

/** Файл карты — `_index.json` объекта или `config.json` его метрики или экшона. */
const LAYER_CONFIG = new RegExp(`/(${METRICS}|${ACTIONS})/[^/]+/${CONFIG}$`);
const isMapFile = (path: string) => basename(path) === INDEX || LAYER_CONFIG.test(path);

/**
 * Кто ссылается на сам объект — его адрес строкой (`extends`, конец связи, `адрес#поле`) в файлах
 * карты, кроме лежащих в `except`. Адрес потомка — не ссылка на объект: потомок остаётся.
 */
export function referencesTo(
  files: ReadonlyMap<string, string>,
  address: string,
  except: (path: string) => boolean,
): string[] {
  const found: string[] = [];
  for (const [path, text] of files) {
    if (except(path) || !isMapFile(path)) continue;
    for (const [token] of text.matchAll(JSON_STRING)) {
      let value: unknown;
      try {
        value = JSON.parse(token);
      } catch {
        continue;
      }
      if (typeof value === "string" && (value === address || value.startsWith(`${address}#`))) {
        found.push(path);
        break;
      }
    }
  }
  return found;
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Перенесённые и скопированные с потомками — по снимку до правки. */
function expand(root: MapObject, renames: ReadonlyMap<string, string>): Move[] {
  const moves: Move[] = [];
  for (const [from, to] of renames) {
    const object = findObject(root, from);
    if (!object) continue;
    walk(object, (inner) => {
      moves.push({ from: inner.address, to: to + inner.address.slice(from.length) });
    });
  }
  return moves;
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

  /** Переписать адреса во всех файлах карты. */
  rename(renames: ReadonlyMap<string, string>): void {
    for (const [path, text] of Array.from(this.texts)) {
      if (!isMapFile(path)) continue;
      const next = rewriteJson(text, renames);
      if (next !== text) this.write(path, next);
    }
  }

  move(from: string, to: string): void {
    this.moves.push({ kind: "move", from, to });
    // Копия, а не сам словарь: ключи в нём переставляются по ходу.
    for (const [path, text] of Array.from(this.texts)) {
      if (!inside(path, from)) continue;
      const next = to + path.slice(from.length);
      this.texts.delete(path);
      this.texts.set(next, text);
      if (this.written.delete(path)) this.written.add(next);
    }
  }

  remove(path: string): void {
    this.removed.push(path);
    for (const known of Array.from(this.texts.keys())) {
      if (!inside(known, path)) continue;
      this.texts.delete(known);
      this.written.delete(known);
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

/** Свободное имя папки у родителя: занятое получает номер. */
function claimer() {
  const taken = new Map<string, Set<string>>();
  return (parent: MapObject, wanted: string): string => {
    const names =
      taken.get(parent.path) ?? new Set(parent.children.map((child) => basename(child.path)));
    taken.set(parent.path, names);
    let name = wanted;
    for (let index = 2; names.has(name); index += 1) name = `${wanted}-${index}`;
    names.add(name);
    return name;
  };
}

const fail = (error: string): EditPlan => ({ error });

/** Объект с `_index.json`: его поля можно править. Полка — папка без него — объектом не бывает. */
export function indexed(root: MapObject, address: string): MapObject | undefined {
  const object = findObject(root, address);
  return object && !object.isGroup ? object : undefined;
}

/** Объект, который можно унести, удалить или скопировать: не корень и не полка. */
function editable(root: MapObject, address: string): MapObject | undefined {
  const object = indexed(root, address);
  return object && object.address !== MAP_ROOT ? object : undefined;
}

const done = (draft: Draft, extra: Partial<Extract<EditPlan, { changes: FileChange[] }>> = {}) =>
  ({ changes: draft.changes(), moves: [], copies: [], ...extra }) as EditPlan;

/**
 * Перенос папки под нового родителя и, может быть, под новым именем — общее у переноса и смены
 * папки. Переписывает адрес объекта и его потомков во всех файлах карты.
 */
function relocate(
  root: MapObject,
  draft: Draft,
  object: MapObject,
  parent: MapObject,
  folder: string,
): EditPlan {
  const address = childAddress(parent.address, folder);
  if (address === object.address) return done(draft);
  if (parent.children.some((child) => child !== object && basename(child.path) === folder)) {
    return fail(`В ${parent.name} уже есть ${folder}`);
  }
  const renames = new Map([[object.address, address]]);
  draft.move(object.path, join(parent.path, folder));
  draft.rename(renames);
  return done(draft, { moves: expand(root, renames) });
}

/** Операции структуры карты — их считает `planEdit`; свои поля и файлы считает `FieldOps`. */
export type StructureOp = Extract<MapEditOp, { op: "create" | "move" | "setFolder" | "copy" }>;

/** Удаление объекта или полки целиком — с папкой и всем, что в ней. */
export type DeleteObject = { op: "delete"; address: string; recursive?: boolean };

/**
 * Родитель, которого в модели ещё нет: папки на пути создаст запись. Детей у него нет — имя
 * папки свободно.
 */
function implicitParent(root: MapObject, address: string): MapObject | undefined {
  const parsed = parseAddress(address);
  if (!parsed || parsed.scope !== "map" || parsed.field) return undefined;
  if (parsed.path.some((step) => step.startsWith("_") || step.startsWith("."))) return undefined;
  return {
    ...root,
    address: mapAddress(parsed.path),
    path: join(root.path, ...parsed.path),
    name: parsed.path.at(-1) ?? "",
    isGroup: true,
    children: [],
  };
}

/** Имя папки, которое можно положить у родителя: не служебное и без слэшей. */
function folderName(given: string): string | undefined {
  const folder = slug(given);
  return folder.startsWith("_") || folder.startsWith(".") ? undefined : folder;
}

/** Одна операция — полный список правок или отказ с причиной. */
export function planEdit(context: EditContext, op: StructureOp | DeleteObject): EditPlan {
  const { root } = context;
  const draft = new Draft(context.files);

  switch (op.op) {
    case "create": {
      // Папки неявные, как в git: родителя, которого ещё нет, создаёт сама запись индекса.
      const parent = findObject(root, op.parent) ?? implicitParent(root, op.parent);
      if (!parent) return fail(`${op.parent} — не адрес карты, куда класть новый`);
      const name = typeof op.content.name === "string" ? op.content.name.trim() : "";
      const wanted = op.folder ?? name;
      if (!wanted) return fail("Ни имени папки (folder), ни content.name — папку назвать нечем");
      const extended = op.content.extends;
      if (typeof extended === "string" && !indexed(root, extended)) {
        return fail(`Нет прототипа ${extended}`);
      }
      const folder = folderName(wanted);
      if (!folder) return fail(`Имя папки ${wanted} служебное: с «_» и «.» начинается не объект`);
      const claimed = claimer()(parent, folder);
      draft.write(join(parent.path, claimed, INDEX), json(op.content));
      return done(draft, { created: childAddress(parent.address, claimed) });
    }

    case "delete": {
      const object = findObject(root, op.address);
      if (!object || object.address === MAP_ROOT) return fail(`Нет объекта ${op.address}`);
      if (object.isGroup) {
        // Полка — только порядок, но внутри неё бывают объекты: они уходят лишь по явному слову.
        const inner: string[] = [];
        walk(object, (one) => {
          if (!one.isGroup) inner.push(one.address);
        });
        if (inner.length > 0 && op.recursive !== true) {
          return fail(
            `В полке ${op.address} есть объекты: ${inner.toSorted().join(", ")}. Унеси их или удали с recursive: true`,
          );
        }
      }
      draft.remove(object.path);
      return done(draft);
    }

    case "move": {
      const object = findObject(root, op.object);
      if (!object || object.address === MAP_ROOT) return fail(`Нет объекта ${op.object}`);
      const parent = findObject(root, op.parent);
      if (!parent) return fail(`Нет объекта ${op.parent}, куда переносить`);
      if (within(parent.address, object.address)) {
        return fail("Объект нельзя перенести внутрь самого себя");
      }
      return relocate(root, draft, object, parent, basename(object.path));
    }

    case "setFolder": {
      // Полка переименовывается так же, как объект: адреса всех внутри едут вместе с ней.
      const object = findObject(root, op.object);
      if (!object || object.address === MAP_ROOT) return fail(`Нет объекта ${op.object}`);
      const parent = trail(root, object.address).at(-2);
      if (!parent) return fail(`Нет родителя у ${op.object}`);
      const folder = folderName(op.folder);
      if (!folder) return fail(`Имя папки ${op.folder} служебное`);
      return relocate(root, draft, object, parent, folder);
    }

    case "copy": {
      const wanted: { object: MapObject; parent: MapObject }[] = [];
      for (const { object: address, parent: place } of op.objects) {
        const object = editable(root, address);
        if (!object) return fail(`Нет объекта ${address}: его удалили или перенесли`);
        const parent = findObject(root, place);
        if (!parent) return fail(`Нет объекта ${place}, куда класть копию`);
        wanted.push({ object, parent });
      }
      // Лежащий внутри другого копируемого едет с ним и отдельно не копируется.
      const tops = wanted.filter(
        ({ object }) =>
          !wanted.some(
            (other) => other.object !== object && within(object.address, other.object.address),
          ),
      );
      if (tops.length === 0) return fail("Копировать нечего");

      const claim = claimer();
      const renames = new Map<string, string>();
      const folders = new Map<string, string>();
      for (const { object, parent } of tops) {
        const folder = claim(parent, basename(object.path));
        renames.set(object.address, childAddress(parent.address, folder));
        folders.set(object.path, join(parent.path, folder));
      }

      // Копируются файлы карты; директивы и кэши остаются у оригинала. Адреса копируемых в
      // текстах копий — адреса копий: копия ссылается на копии, а не на оригиналы.
      const skipped = (op.skip ?? [])
        .map((address) => findObject(root, address)?.path)
        .filter((path): path is string => path !== undefined);
      for (const [from, to] of folders) {
        for (const [path, text] of context.files) {
          if (!inside(path, from) || skipped.some((cut) => inside(path, cut))) continue;
          draft.write(to + path.slice(from.length), rewriteJson(text, renames));
        }
      }
      const copies = expand(root, renames).filter(
        (copy) => !(op.skip ?? []).some((cut) => within(copy.from, cut)),
      );
      return done(draft, { copies });
    }
  }
}
