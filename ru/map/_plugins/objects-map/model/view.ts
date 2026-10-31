import type { MapMetric, MapObject } from "@mapward/plugin";
import { childAddress, findMetricOwner, memberOwner } from "./map.ts";
import type {
  ArrowStyle,
  LinePattern,
  NodeShape,
  NodeView,
  ObjectsMap,
  PaletteItem,
  Point,
  Size,
  TextAlign,
  ViewNode,
  ViewRelation,
  ViewShape,
} from "./types.ts";

/** Пути карты — строки с прямыми слэшами, как их отдаёт модель. */
const slash = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");
const join = (...parts: string[]) => parts.map(slash).join("/");
const samePath = (a: string, b: string): boolean => slash(a) === slash(b);

/**
 * Вьюха карты — решение 0044: метрика-компонент этого плагина, у которой в `params` сказано, что
 * показать. Корня у вьюхи нет: на холсте ровно то, что метрика называет явно, плюс ссылки,
 * добавленные на холсте. Что раскрыто, как нарисован узел и куда идут стрелки, считает эта
 * функция — холст получает готовую картинку и ничего не решает сам, а агент видит то же, что
 * человек. Связь — понятие холста, а не карты: объект, у которого в `props` строками стоят
 * `from` и `to`, рисуется стрелкой.
 */

/** Состояние вьюхи — рядом с `config.json` её метрики, в папке объекта. */
export const VIEW_STATE = "map-state.json";

/** Узор линии для прототипов связей без своего: по месту в палитре, по кругу. */
export const LINE_PATTERNS: LinePattern[] = ["solid", "dashed", "dotted"];

/**
 * Как нарисовать объект. Задаётся на трёх уровнях — для всех, для прототипа, для объекта, — и
 * побеждает самый узкий, поле за полем: прототип даёт цвет, объект уточняет только вид.
 */
export type NodeStyle = {
  shape?: NodeShape;
  color?: string;
  /** Цвет подписи; не задан — тёмный или светлый, смотря по цвету карточки. */
  textColor?: string;
  /** Поле `props`, которое идёт подписью; не задано или пусто — имя объекта. */
  label?: string;
  view?: NodeView;
  /** У связи — её линия; цвет связи — `color`. */
  line?: LinePattern;
  /** Вкладка и размер полного превью — как у карточки объекта. */
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
  /** Выравнивание подписи по горизонтали; не задано — по центру. */
  align?: TextAlign;
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

/**
 * То, что меняется на холсте. Позиция узла внутри группы — относительно группы, поэтому группа
 * двигается вместе с жильцами, а сдвиг группы не переписывает позиции её детей.
 */
export type ViewState = {
  positions?: Record<string, Point>;
  /** Ссылки на чужие объекты: удалить ссылку не значит удалить объект. */
  refs?: string[];
  shapes?: ViewShape[];
  /**
   * Размер узла, растянутого руками, — у полного превью: карточка с метриками бывает нужна
   * крупнее, чем задал стиль. Перекрывает `width` и `maxHeight` стиля у этого узла.
   */
  sizes?: Record<string, Size>;
  /** Изломы стрелки: точки, через которые она идёт, по `id` стрелки на этой вьюхе. */
  bends?: Record<string, Point[]>;
  /** Стиль стрелок по их `id`: связь на разных вьюхах рисуется по-разному. */
  arrows?: Record<string, ArrowStyle>;
  /**
   * Копии-отображения по их `id` — `<адрес объекта>#<номер>`: ещё один узел того же объекта на
   * этом холсте. Папки у копии нет, позиция и размер пишутся по её `id`.
   */
  copies?: Record<string, ViewCopy>;
  /** Концы связей, привязанные к копиям: по адресу связи — `id` копии у `from` и `to`. */
  ends?: Record<string, { from?: string; to?: string }>;
};

/**
 * Копия-отображение. `parent` — фрейм, на котором она лежит: рисуется внутри него и ездит с ним,
 * но жильцом не становится — объект остаётся, где жил.
 */
export type ViewCopy = { object: string; parent?: string };

/** `id` копии: адрес объекта и номер после `#` — адрес переписывается переносом сам. */
export const copyId = (object: string, index: number): string => `${object}#${index}`;

/** Канал цвета в линейную яркость — по WCAG. */
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Подпись, читаемая на карточке: тёмная на светлом и светлая на тёмном. Понимает `#rgb` и
 * `#rrggbb`; остальное (имена, переменные темы) — не знает, и цвет подписи остаётся за темой.
 */
export function readableText(color: string | undefined): string | undefined {
  const hex = color?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255);
  const luminance = 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
  return luminance > 0.4 ? "#1f1f1f" : "#ffffff";
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** Конфиг вьюхи из `params` метрики; лишнее и неверного типа отбрасывается. */
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

/**
 * Вьюха среди метрик карты — метрика-компонент, у которой плагин запроса для агента — этот
 * плагин. Чужие метрики вьюхой не считаются, даже если у них похожие `params`.
 */
export type IsView = (metric: MapMetric) => boolean;

/** Вьюха — метрика, чей `agent.plugin` (уже абсолютный после чтения карты) — папка плагина. */
export const viewsOf =
  (pluginDir: string): IsView =>
  (metric) =>
    metric.config.agent !== undefined && samePath(metric.config.agent.plugin, pluginDir);

/** Вьюха по адресу: её конфиг — `params` метрики, состояние — `map-state.json` в её папке. */
export type FoundView = { config: ObjectsMapConfig; statePath: string };

export function findView(root: MapObject, address: string, isView: IsView): FoundView | string {
  const found = findMetricOwner(root, address);
  if (!found) return `Вьюхи ${address} нет`;
  if (!isView(found.metric)) return `Метрика ${address} — не вьюха objects-map`;
  return {
    config: objectsMapConfig(found.metric.config.params ?? {}),
    // Состояние лежит в папке объекта, а не прототипа: у наследника вьюха своя.
    statePath: join(found.metric.cachePath, VIEW_STATE),
  };
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

/** Кусок карты, который нужен вьюхе: поддерево от адреса на глубину (`ctx.tree`). */
export type ViewPart = { address: string; depth: number };

/** Объект, у которого лежит метрика-вьюха: его читают, чтобы найти её конфиг и состояние. */
export const viewHolder = (view: string): string | undefined => memberOwner(view);

/** Адрес маски без звёзд: `packages/*` — `mapward://packages`, адрес как есть — он сам. */
const addressOf = (path: string) => (path === "" ? ROOT : `${ROOT}${path.replace(/\/+$/, "")}`);

/**
 * Что вьюхе читать — решение 0044 с ленивой картой: только ветки, которые она показывает, а не
 * карту целиком. Маска даёт глубину: `x/*` — дети `x`, `x/**` — всё под `x`, адрес — он сам.
 * Раскрытый узел рисует жильцов, а жильцы бывают где угодно под ним, — поэтому с `expand` ветки
 * читаются до конца. Стрелки — связи из `placeRelations` и из показанных веток. Ссылки, копии и
 * палитра — объектами по адресу.
 *
 * Объекты прототипа по всей карте (`prototypes`) иначе как обходом карты не найти: наследник
 * знает прототип, а прототип наследников — нет. Поэтому только с ними вьюха читает всю карту, и
 * это `Infinity` от корня.
 */
export function viewParts(config: ObjectsMapConfig, state: ViewState): ViewPart[] {
  const frames = config.expand.objects.length > 0 || config.expand.prototypes.length > 0;
  const deep = (depth: number) => (frames ? Infinity : depth);
  const parts: ViewPart[] = [];
  for (const pattern of config.show) {
    const target = pattern.startsWith(ROOT) ? relative(pattern) : pattern;
    if (target.endsWith("/**")) {
      parts.push({ address: addressOf(target.slice(0, -3)), depth: Infinity });
    } else if (target.includes("*")) {
      const [head = ""] = target.split("*");
      parts.push({ address: addressOf(head.slice(0, head.lastIndexOf("/") + 1)), depth: deep(1) });
    } else {
      parts.push({ address: addressOf(target), depth: deep(0) });
    }
  }
  if (config.prototypes.length > 0) parts.push({ address: ROOT, depth: Infinity });
  if (config.placeRelations !== undefined) {
    parts.push({ address: config.placeRelations, depth: Infinity });
  }
  for (const address of state.refs ?? []) parts.push({ address, depth: deep(0) });
  for (const copy of Object.values(state.copies ?? {})) {
    parts.push({ address: copy.object, depth: 0 });
  }
  for (const address of [...config.palette.objects, ...config.palette.relations]) {
    parts.push({ address, depth: 0 });
  }
  // Одна ветка — один поток: из одинаковых адресов остаётся самый глубокий.
  const deepest = new Map<string, ViewPart>();
  for (const part of parts) {
    const known = deepest.get(part.address);
    if (!known || known.depth < part.depth) deepest.set(part.address, part);
  }
  return [...deepest.values()];
}

/** Папка на пути, которую никто не прочёл: полка без полей, на холст она не встаёт. */
const stub = (address: string, name: string): MapObject => ({
  address,
  path: "",
  name,
  isGroup: true,
  props: {},
  layers: [],
  metrics: [],
  directives: [],
  actions: [],
  workflow: [],
  metricGroups: [],
  children: [],
});

/** Тот же объект, прочитанный двумя кусками: дети — объединением, глубже — тоже. */
function mergeObject(a: MapObject, b: MapObject, stubs: Set<MapObject>): MapObject {
  const own = stubs.has(a) ? b : a;
  const children = [...a.children];
  for (const child of b.children) {
    const at = children.findIndex((known) => known.address === child.address);
    if (at === -1) children.push(child);
    else children[at] = mergeObject(children[at] as MapObject, child, stubs);
  }
  const merged = { ...own, children };
  if (stubs.has(a) && stubs.has(b)) stubs.add(merged);
  return merged;
}

/**
 * Куски карты одним деревом от корня — его ждёт `objectsMap`. Куда кусок встаёт, говорит его
 * адрес; непрочитанные папки на пути — полки-заглушки.
 */
export function joinParts(parts: (MapObject | undefined)[]): MapObject {
  const stubs = new Set<MapObject>();
  const place = (at: MapObject, segments: string[], part: MapObject): MapObject => {
    if (segments.length === 0) return mergeObject(at, part, stubs);
    const [name = "", ...rest] = segments;
    const address = childAddress(at.address, name);
    const children = [...at.children];
    const index = children.findIndex((child) => child.address === address);
    const existing = index === -1 ? undefined : children[index];
    const next = existing ?? stub(address, name);
    if (!existing) stubs.add(next);
    const placed = place(next, rest, part);
    if (index === -1) children.push(placed);
    else children[index] = placed;
    const result = { ...at, children };
    if (stubs.has(at)) stubs.add(result);
    return result;
  };
  let root = stub(ROOT, "");
  stubs.add(root);
  for (const part of parts) {
    if (!part) continue;
    const path = relative(part.address).split("/").filter(Boolean);
    root = place(root, path, part);
  }
  return root;
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

function paletteItem(root: MapObject, config: ObjectsMapConfig, address: string): PaletteItem {
  let label = address;
  walk(root, (object) => {
    if (object.address === address) label = object.name;
  });
  const own = config.style.prototypes?.[address] ?? config.style.prototypes?.[label];
  const color = own?.color ?? config.style.all?.color;
  const textColor = own?.textColor ?? config.style.all?.textColor ?? readableText(color);
  const frame = config.expand.prototypes.some((key) => key === address || key === label);
  return {
    prototype: address,
    label,
    ...(color === undefined ? {} : { color }),
    ...(textColor === undefined ? {} : { textColor }),
    ...(frame ? { frame } : {}),
  };
}

/**
 * Как рисуется стрелка связи: цвет и линия — из стиля её прототипа. Стиль «для всех» сюда не
 * идёт — он про узлы. Прототип без своей линии, стоящий в палитре, получает узор по месту в ней:
 * две связи из палитры не выглядят одинаково, даже когда стиль им не задавали.
 */
function relationLook(
  relation: MapObject,
  config: ObjectsMapConfig,
): { color?: string; line?: LinePattern } {
  const own = Object.entries(config.style.prototypes ?? {})
    .filter(([key]) => ofPrototype(relation, [key]))
    .map(([, style]) => style);
  const style = Object.assign({}, ...own) as NodeStyle;
  const index = config.palette.relations.findIndex((key) => ofPrototype(relation, [key]));
  const line = style.line ?? (index < 0 ? undefined : LINE_PATTERNS[index % LINE_PATTERNS.length]);
  return {
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(line === undefined ? {} : { line }),
  };
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
  const place = (
    object: MapObject,
    kind: ViewNode["kind"],
    parent: string | undefined,
    id: string = object.address,
  ) => {
    const style = styleOf(object, config);
    const inside = residents(object).filter((child) => !cut.has(child.address));
    const configured =
      config.expand.objects.some((pattern) => matchesAddress(object.address, pattern)) ||
      ofPrototype(object, config.expand.prototypes);
    // Раскрытый конфигом — группа и без жильцов: ограниченный контекст ставят пустой рамкой и
    // бросают в него стикеры. Не раскрытый — один узел, стрелки к жильцам подняты к нему (C4).
    // Копия — один узел: копию фрейма не делают, а ставший фреймом позже рисуется карточкой.
    const expanded = kind !== "copy" && configured;
    const position = state.positions?.[id];
    const size = state.sizes?.[id];

    nodes.push({
      id,
      kind,
      label: labelOf(object, style),
      link: object.address,
      object: object.address,
      ...(object.prototypeName === undefined ? {} : { prototype: object.prototypeName }),
      ...(parent === undefined ? {} : { parent }),
      shape: style.shape ?? "rect",
      ...(style.color === undefined ? {} : { color: style.color }),
      ...((style.textColor ?? readableText(style.color)) === undefined
        ? {}
        : { textColor: style.textColor ?? readableText(style.color) }),
      view: style.view ?? "simple",
      ...(style.group === undefined ? {} : { group: style.group }),
      ...(style.width === undefined ? {} : { width: style.width }),
      ...(style.maxHeight === undefined ? {} : { maxHeight: style.maxHeight }),
      ...(style.align === undefined ? {} : { align: style.align }),
      expanded,
      ...(position === undefined ? {} : { position }),
      ...(size === undefined ? {} : { size }),
    });
    if (expanded) for (const child of inside) place(child, "object", object.address);
  };
  for (const { object, kind } of tops) place(object, kind, undefined);

  // Копии — после всех: фрейм, на котором копия лежит, уже на холсте. Нет его — копия на холсте.
  const frames = new Set(nodes.filter((node) => node.expanded).map((node) => node.id));
  const copies = new Set<string>();
  for (const [id, copy] of Object.entries(state.copies ?? {})) {
    const object = byAddress.get(copy.object);
    if (!object || object.isGroup || isRelation(object) || cut.has(object.address)) continue;
    const parent = copy.parent !== undefined && frames.has(copy.parent) ? copy.parent : undefined;
    place(object, "copy", parent, id);
    copies.add(id);
  }

  // Видимый узел для адреса — самый глубокий из показанных, внутри которого адрес лежит. Копия
  // им не бывает: на неё стрелка попадает только привязкой.
  const shown = nodes
    .map((node) => node.id)
    .filter((id) => !copies.has(id))
    .toSorted((a, b) => b.length - a.length);
  const visible = (address: string) => shown.find((id) => within(address, id));

  const arrows = new Map<string, ViewRelation>();
  for (const relation of relations) {
    const { from, to } = relation.props as { from: string; to: string };
    const bound = state.ends?.[relation.address];
    const end = (copy: string | undefined, address: string) =>
      copy !== undefined && copies.has(copy) ? copy : visible(address);
    const a = end(bound?.from, from);
    const b = end(bound?.to, to);
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
    // Склеенная стрелка рисуется так, как первая из её связей.
    arrows.set(key, {
      id: key,
      from: a,
      to: b,
      label: relation.name,
      link: relation.address,
      count: 1,
      relations: [item],
      ...relationLook(relation, config),
    });
  }

  for (const arrow of arrows.values()) {
    const bends = state.bends?.[arrow.id];
    if (bends && bends.length > 0) arrow.bends = bends;
    const style = state.arrows?.[arrow.id];
    if (style) arrow.style = style;
  }

  return {
    view,
    nodes,
    relations: [...arrows.values()],
    shapes: state.shapes ?? [],
    palette: {
      objects: config.palette.objects.map((address) => paletteItem(root, config, address)),
      relations: config.palette.relations.map((address, index) => {
        const item = paletteItem(root, config, address);
        const own = config.style.prototypes?.[address] ?? config.style.prototypes?.[item.label];
        const line = own?.line ?? LINE_PATTERNS[index % LINE_PATTERNS.length];
        return line === undefined ? item : { ...item, line };
      }),
    },
    canPlaceObjects: config.placeObjects !== undefined,
    canPlaceRelations: config.placeRelations !== undefined,
  };
}
