import type { MapObject } from "./model.ts";

/**
 * Вьюха карты — метрика с коллектором `objects-map` (решение 0044). Корня у вьюхи нет: на
 * холсте ровно то, что метрика называет явно, плюс ссылки, добавленные на холсте. Что раскрыто,
 * как нарисован узел и куда идут стрелки, считает эта функция — холст получает готовую
 * картинку и ничего не решает сам, а агент через MCP видит то же, что человек.
 */

export const OBJECTS_MAP = "objects-map";
/** Состояние вьюхи — рядом с `config.json` её метрики, в папке объекта. */
export const VIEW_STATE = "map-state.json";

export type NodeShape = "rect" | "round" | "ellipse" | "diamond" | "note";
export type NodeView = "simple" | "preview";

/**
 * Как нарисовать объект. Задаётся на трёх уровнях — для всех, для прототипа, для объекта, — и
 * побеждает самый узкий, поле за полем: прототип даёт цвет, объект уточняет только вид.
 */
export type NodeStyle = {
  shape?: NodeShape;
  color?: string;
  /** Поле `props`, которое идёт подписью; не задано или пусто — имя объекта. */
  label?: string;
  view?: NodeView;
  /** Вкладка и размер полного превью — как у карточки объекта. */
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
};

export type ObjectsMapConfig = {
  /** Что показывать: адреса и маски (`packages/*`, `mapward://apps/cli`). */
  show: string[];
  /** И объекты этих прототипов — адресом прототипа или его именем. */
  prototypes: string[];
  /** Что вырезать вместе с веткой. */
  exclude: string[];
  /** Что рисуется группой с жильцами внутри; остальное — одним узлом. */
  expand: { objects: string[]; prototypes: string[] };
  style: {
    all?: NodeStyle;
    prototypes?: Record<string, NodeStyle>;
    objects?: Record<string, NodeStyle>;
  };
  /** Прототипы, которые боковая панель ставит на этой вьюхе, — адресами. */
  palette: { objects: string[]; relations: string[] };
  /** Куда уходит объект, брошенный на пустое место; не назван — создавать там нельзя. */
  placeObjects?: string;
  /** Куда кладутся новые связи: объект или полка. Не назван — стрелку провести нельзя. */
  placeRelations?: string;
};

export type Point = { x: number; y: number };

/** Фигура — пометка на холсте, не объект карты: ни папки, ни метрик. */
export type ViewShape = {
  id: string;
  kind: "rect" | "ellipse" | "text";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
};

/**
 * То, что меняется на холсте. Позиция узла внутри группы — относительно группы, поэтому группа
 * двигается вместе с жильцами, а сдвиг группы не переписывает позиции её детей.
 */
export type ViewState = {
  positions?: Record<string, Point>;
  /** Свёрнуто или развёрнуто руками поверх конфига. */
  expanded?: Record<string, boolean>;
  /** Ссылки на чужие объекты: удалить ссылку не значит удалить объект. */
  refs?: string[];
  shapes?: ViewShape[];
};

export type ViewNode = {
  id: string;
  kind: "object" | "ref";
  label: string;
  link: string;
  /** Адрес объекта — у узла с полным превью по нему рисуется карточка. */
  object: string;
  prototype?: string;
  /** Группа, внутри которой узел нарисован; нет — лежит на холсте. */
  parent?: string;
  shape: NodeShape;
  color?: string;
  view: NodeView;
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
  /** Есть ли у объекта жильцы — только такой узел можно развернуть. */
  expandable: boolean;
  expanded: boolean;
  position?: Point;
};

/**
 * Стрелка на холсте. Концы — узлы, которые видны: стрелка к жильцу свёрнутой группы поднята к
 * группе, как в C4. Несколько связей на одну пару узлов склеены в одну, и `relations`
 * говорит, из каких она собрана.
 */
export type ViewRelation = {
  id: string;
  from: string;
  to: string;
  label?: string;
  link?: string;
  count: number;
  relations: { label: string; link: string }[];
};

export type PaletteItem = { prototype: string; label: string };

/** Значение метрики `objects-map` — данные дисплея `map`. */
export type ObjectsMap = {
  /** Адрес метрики: операции холста правят именно эту вьюху. */
  view: string;
  nodes: ViewNode[];
  relations: ViewRelation[];
  shapes: ViewShape[];
  palette: { objects: PaletteItem[]; relations: PaletteItem[] };
  /** Можно ли создавать объект на пустом месте и проводить стрелки. */
  canPlaceObjects: boolean;
  canPlaceRelations: boolean;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** Конфиг коллектора как он лежит в `collectors`; лишнее и неверного типа отбрасывается. */
export function objectsMapConfig(spec: Record<string, unknown>): ObjectsMapConfig {
  const expand = record(spec.expand);
  const style = record(spec.style);
  const palette = record(spec.palette);
  return {
    show: strings(spec.show),
    prototypes: strings(spec.prototypes),
    exclude: strings(spec.exclude),
    expand: { objects: strings(expand.objects), prototypes: strings(expand.prototypes) },
    style: {
      all: style.all as NodeStyle | undefined,
      prototypes: style.prototypes as Record<string, NodeStyle> | undefined,
      objects: style.objects as Record<string, NodeStyle> | undefined,
    },
    palette: { objects: strings(palette.objects), relations: strings(palette.relations) },
    placeObjects: text(spec.placeObjects),
    placeRelations: text(spec.placeRelations),
  };
}

/** Состояние вьюхи из текста файла; битое или пустое — пустое состояние, а не ошибка. */
export function parseViewState(raw: string | undefined): ViewState {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as ViewState) : {};
  } catch {
    return {};
  }
}

/** Конфиг первого коллектора `objects-map` метрики — одна метрика рисует одну вьюху. */
export function viewSpec(collectors: Record<string, unknown>[] | undefined) {
  return collectors?.find((spec) => spec.kind === OBJECTS_MAP);
}

const ROOT = "mapward://";

/** Адрес относительно корня карты, как его пишут в масках: `packages/core`. */
const relative = (address: string) => address.slice(ROOT.length);

/**
 * Маска проще glob нарочно — как была у карты детей: `packages/*` — дети полки, но не их дети,
 * `packages/**` — вся ветка. Адрес целиком (`mapward://…`) сравнивается как есть.
 */
export function matchesAddress(address: string, pattern: string): boolean {
  const target = pattern.startsWith(ROOT) ? relative(pattern) : pattern;
  const own = relative(address);
  if (target.endsWith("/**")) {
    const head = target.slice(0, -3);
    return own.startsWith(`${head}/`);
  }
  if (!target.includes("*")) return own === target;
  const [head = ""] = target.split("*");
  return own.startsWith(head) && !own.slice(head.length).includes("/");
}

/** Лежит ли `inner` внутри `outer` (или это он сам). Корень содержит всё. */
export function within(inner: string, outer: string): boolean {
  return outer === ROOT || inner === outer || inner.startsWith(`${outer}/`);
}

export const isRelation = (object: MapObject): boolean => {
  const { from, to } = object.props as { from?: unknown; to?: unknown };
  return typeof from === "string" && typeof to === "string";
};

/** Адрес прототипа — второй слой объекта (решение 0019). */
export const prototypeOf = (object: MapObject): string | undefined => object.layers[1]?.address;

function walk(object: MapObject, visit: (object: MapObject) => void): void {
  visit(object);
  for (const child of object.children) walk(child, visit);
}

/**
 * Жильцы объекта на холсте — его дети-объекты. Полка — папка без `_index.json` — сама на холст
 * не встаёт, её дети поднимаются на уровень выше. Связи жильцами не бывают: они стрелки.
 */
export function residents(object: MapObject): MapObject[] {
  const found: MapObject[] = [];
  for (const child of object.children) {
    if (child.isGroup) found.push(...residents(child));
    else if (!isRelation(child)) found.push(child);
  }
  return found;
}

const ofPrototype = (object: MapObject, keys: string[]): boolean =>
  keys.some((key) => key === prototypeOf(object) || key === object.prototypeName);

/** Стиль узла: для всех, потом прототип, потом объект — узкий перекрывает поле за полем. */
export function styleOf(object: MapObject, config: ObjectsMapConfig): NodeStyle {
  const byPrototype = Object.entries(config.style.prototypes ?? {})
    .filter(([key]) => ofPrototype(object, [key]))
    .map(([, style]) => style);
  const byObject = Object.entries(config.style.objects ?? {})
    .filter(([pattern]) => matchesAddress(object.address, pattern))
    .map(([, style]) => style);
  return Object.assign({}, config.style.all, ...byPrototype, ...byObject) as NodeStyle;
}

/** Подпись узла: поле `props` из стиля, если оно строка, иначе имя объекта. */
export function labelOf(object: MapObject, style: NodeStyle): string {
  const field = style.label ? object.props[style.label] : undefined;
  return typeof field === "string" && field !== "" ? field : object.name;
}

function paletteItem(root: MapObject, address: string): PaletteItem {
  let label = address;
  walk(root, (object) => {
    if (object.address === address) label = object.name;
  });
  return { prototype: address, label };
}

/**
 * Вьюха по модели, конфигу и состоянию — решение 0044. Чистая: ни диска, ни часов, поэтому
 * свёртка, подъём стрелок и склейка проверяются тестами без холста.
 */
export function objectsMap(
  root: MapObject,
  view: string,
  config: ObjectsMapConfig,
  state: ViewState,
): ObjectsMap {
  const excluded = (object: MapObject) =>
    config.exclude.some((pattern) => matchesAddress(object.address, pattern));

  const byAddress = new Map<string, MapObject>();
  const relations: MapObject[] = [];
  const cut = new Set<string>();
  walk(root, (object) => {
    byAddress.set(object.address, object);
    if (excluded(object) || [...cut].some((branch) => within(object.address, branch))) {
      cut.add(object.address);
      return;
    }
    if (isRelation(object)) relations.push(object);
  });

  const chosen = (object: MapObject) =>
    !object.isGroup &&
    !isRelation(object) &&
    !cut.has(object.address) &&
    (config.show.some((pattern) => matchesAddress(object.address, pattern)) ||
      ofPrototype(object, config.prototypes));

  const tops: { object: MapObject; kind: ViewNode["kind"] }[] = [];
  const picked = new Set<string>();
  walk(root, (object) => {
    if (chosen(object)) picked.add(object.address);
  });
  for (const address of picked) {
    // Выбранный внутри выбранного — жилец: он появится, когда развернут его группу.
    const nested = [...picked].some((other) => other !== address && within(address, other));
    const object = byAddress.get(address);
    if (!nested && object) tops.push({ object, kind: "object" });
  }
  for (const address of state.refs ?? []) {
    const object = byAddress.get(address);
    if (!object || picked.has(address)) continue;
    tops.push({ object, kind: "ref" });
  }

  const nodes: ViewNode[] = [];
  const place = (object: MapObject, kind: ViewNode["kind"], parent: string | undefined) => {
    const style = styleOf(object, config);
    const inside = residents(object).filter((child) => !cut.has(child.address));
    const configured =
      config.expand.objects.some((pattern) => matchesAddress(object.address, pattern)) ||
      ofPrototype(object, config.expand.prototypes);
    const expanded = inside.length > 0 && (state.expanded?.[object.address] ?? configured);
    const position = state.positions?.[object.address];

    nodes.push({
      id: object.address,
      kind,
      label: labelOf(object, style),
      link: object.address,
      object: object.address,
      ...(object.prototypeName === undefined ? {} : { prototype: object.prototypeName }),
      ...(parent === undefined ? {} : { parent }),
      shape: style.shape ?? "rect",
      ...(style.color === undefined ? {} : { color: style.color }),
      view: style.view ?? "simple",
      ...(style.group === undefined ? {} : { group: style.group }),
      ...(style.width === undefined ? {} : { width: style.width }),
      ...(style.maxHeight === undefined ? {} : { maxHeight: style.maxHeight }),
      expandable: inside.length > 0,
      expanded,
      ...(position === undefined ? {} : { position }),
    });
    if (expanded) for (const child of inside) place(child, "object", object.address);
  };
  for (const { object, kind } of tops) place(object, kind, undefined);

  // Видимый узел для адреса — самый глубокий из показанных, внутри которого адрес лежит.
  const shown = nodes.map((node) => node.id).toSorted((a, b) => b.length - a.length);
  const visible = (address: string) => shown.find((id) => within(address, id));

  const arrows = new Map<string, ViewRelation>();
  for (const relation of relations) {
    const { from, to } = relation.props as { from: string; to: string };
    const a = visible(from);
    const b = visible(to);
    if (!a || !b || a === b) continue;
    const key = `${a}→${b}`;
    const known = arrows.get(key);
    const item = { label: relation.name, link: relation.address };
    if (known) {
      known.count += 1;
      known.relations.push(item);
      // Склеенная стрелка — не одна связь: подпись и ссылка у неё — число и список.
      known.label = String(known.count);
      delete known.link;
      continue;
    }
    arrows.set(key, {
      id: key,
      from: a,
      to: b,
      label: relation.name,
      link: relation.address,
      count: 1,
      relations: [item],
    });
  }

  return {
    view,
    nodes,
    relations: [...arrows.values()],
    shapes: state.shapes ?? [],
    palette: {
      objects: config.palette.objects.map((address) => paletteItem(root, address)),
      relations: config.palette.relations.map((address) => paletteItem(root, address)),
    },
    canPlaceObjects: config.placeObjects !== undefined,
    canPlaceRelations: config.placeRelations !== undefined,
  };
}
