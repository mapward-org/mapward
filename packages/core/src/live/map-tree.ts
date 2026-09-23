import { computed, reaction, when, type IComputedValue } from "mobx";
import { Check } from "typebox/value";
import { childAddress, MAP_ROOT, parseAddress } from "../model/address.ts";
import { anchorDisplay } from "../model/anchor-display.ts";
import { inherit, resolve, type Inherited } from "../model/inherit.ts";
import { mergeAction, mergeMetric } from "../model/merge.ts";
import type {
  ConfigLayer,
  MapAction,
  MapFile,
  MapMetric,
  MapObject,
  MapStage,
} from "../model/model.ts";
import {
  ACTIONS,
  CONFIG,
  DIRECTIVES,
  directiveStatePath,
  directiveStatus,
  filesOf,
  INDEX,
  isService,
  METRICS,
  ownAction,
  ownMetric,
  ownObject,
  sortStages,
  stageOf,
  WORKFLOW,
  type FolderEntry,
  type OwnObject,
} from "../model/raw-object.ts";
import { ActionConfig, MetricConfig } from "../model/schema.ts";
import { join } from "../lib/path.ts";
import { PENDING, type LiveFiles } from "./files.ts";

/** Какая карта: папка, корень проекта для `@` и имя корня. */
export type LiveMapRef = { mapPath: string; basePath: string; name: string };

/**
 * Чтение внутри одного вычисления. Пришедшее ещё не всё — вычисление досчитывается до конца,
 * чтобы все нужные файлы запросились разом, а результатом отдаёт «ещё не готово». Иначе файлы
 * читались бы по одному: следующий узнаётся, только когда пришёл предыдущий.
 */
class Reads {
  pending = false;

  constructor(private readonly files: LiveFiles) {}

  text(path: string): string | undefined {
    const value = this.files.text(path);
    if (value === PENDING) {
      this.pending = true;
      return undefined;
    }
    return value;
  }

  json(path: string): unknown {
    const text = this.text(path);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  list(path: string): FolderEntry[] {
    const value = this.files.list(path);
    if (value === PENDING) {
      this.pending = true;
      return [];
    }
    return value;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function sameItems(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

type Chain<T> = { config: T; layers: ConfigLayer[] };

/**
 * Значение и готовность — порознь. Пока файл перечитывается, поле держит прежнее значение: оно
 * не проваливается в «не готово» и не возвращается новым объектом, и зависящие от него поля не
 * пересобираются зря. Готовность считается отдельно — по ней ждут карту целиком.
 */
export type Settled<T> = { value: IComputedValue<T | undefined>; pending: IComputedValue<boolean> };

function settled<T>(
  read: () => { value: T | undefined; pending: boolean },
  equals: (a: T | undefined, b: T | undefined) => boolean,
): Settled<T> {
  let last: T | undefined;
  const state = computed(read);
  const value = computed(
    () => {
      const now = state.get();
      if (!now.pending) last = now.value;
      return now.pending ? last : now.value;
    },
    { equals },
  );
  const pending = computed(() => state.get().pending || value.get() === undefined);
  return { value, pending };
}

/** Где объект по адресу, и не потому ли его нет, что папка над ним ещё читается. */
export type Located = { node: LiveObject | undefined; pending: boolean };

const sameLocated = (a: Located, b: Located) => a.node === b.node && a.pending === b.pending;

/** Снимок тот же, если своё то же и дети — те же объекты: неизменённая ветка не рисуется. */
const sameSnapshot = (a: MapObject | undefined, b: MapObject | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    sameItems(a.children, b.children) &&
    sameJson({ ...a, children: [] }, { ...b, children: [] }));

/**
 * Объект живой карты — решение 0041. Каждое поле — вычисляемое значение: своё считается из
 * файлов объекта, собранное — из своего и из уже собранного прототипа, подстановки — из
 * собранных объектов, на которые они ссылаются. Пересчитывается только то поле, чьи источники
 * поменялись, а одинаковый результат дальше не уходит.
 */
export class LiveObject {
  private readonly nodes = new Map<string, LiveObject>();

  /** Своё, как написано в файлах. */
  readonly own: Settled<OwnObject>;
  /** Дети — объекты и группы из подпапок, в порядке папки. */
  readonly children: Settled<LiveObject[]>;
  /** Прототип по `extends`; цепочка по кругу прототипа не даёт. */
  readonly prototype: IComputedValue<Located>;
  /** После наследования, до подстановок. */
  readonly inherited: Settled<Inherited>;
  /** После подстановок — то, что видят сайдбар и агент. */
  readonly resolved: Settled<Inherited>;
  /** Объект вместе с детьми обычными данными: так его отдают агенту и рисуют. */
  readonly snapshot: Settled<MapObject>;

  constructor(
    private readonly tree: LiveMap,
    readonly path: string,
    readonly address: string,
    /** Имя папки: по нему объект ищется у родителя и зовётся, если своего имени нет. */
    readonly folder: string,
  ) {
    this.own = settled(() => this.readOwn(), sameJson);
    // Те же объекты в том же порядке — те же дети: пустая новая папка карты не меняет.
    this.children = settled(() => this.readChildren(), sameItems);
    this.prototype = computed(() => this.findPrototype(), { equals: sameLocated });

    this.inherited = settled(() => {
      const own = this.own.value.get();
      const at = this.prototype.get();
      const base = at.node?.inherited;
      const pending =
        this.own.pending.get() || at.pending || (base !== undefined && base.pending.get());
      if (!own) return { value: undefined, pending: true };
      if (!base) return { value: inherit(own, undefined), pending };
      const prototype = base.value.get();
      return { value: prototype ? inherit(own, prototype) : undefined, pending };
    }, sameJson);

    this.resolved = settled(() => {
      const inherited = this.inherited.value.get();
      let pending = this.inherited.pending.get();
      if (!inherited) return { value: undefined, pending: true };
      // Цель подстановки ещё читается — ответ пока не окончательный, хотя и посчитан.
      const find = (target: string) => {
        const at = this.tree.locate(target);
        if (at.pending || (at.node !== undefined && at.node.inherited.pending.get())) {
          pending = true;
        }
        return at.node?.inherited.value.get();
      };
      const value = resolve(inherited, find, this.tree.ref.basePath);
      return { value, pending };
    }, sameJson);

    this.snapshot = settled(() => {
      const resolved = this.resolved.value.get();
      const children = this.children.value.get();
      let pending = this.resolved.pending.get() || this.children.pending.get();
      if (!resolved || !children) return { value: undefined, pending: true };
      const snapshots: MapObject[] = [];
      for (const child of children) {
        const snapshot = child.snapshot.value.get();
        if (child.snapshot.pending.get()) pending = true;
        if (!snapshot) return { value: undefined, pending: true };
        snapshots.push(snapshot);
      }
      return { value: { ...resolved, children: snapshots }, pending };
    }, sameSnapshot);
  }

  /** Ребёнок по имени папки — тот же объект, пока папка на месте. */
  child(name: string): LiveObject {
    const existing = this.nodes.get(name);
    if (existing) return existing;
    const created = new LiveObject(
      this.tree,
      join(this.path, name),
      childAddress(this.address, name),
      name,
    );
    this.nodes.set(name, created);
    return created;
  }

  private readChildren(): { value: LiveObject[] | undefined; pending: boolean } {
    const reads = new Reads(this.tree.files);
    const entries = reads.list(this.path);
    if (reads.pending) return { value: undefined, pending: true };
    return {
      value: entries
        .filter((entry) => entry.isDirectory && !isService(entry.name))
        .map((entry) => this.child(entry.name)),
      pending: false,
    };
  }

  /** Прототип — объект карты по `extends`; не нашёлся или ведёт по кругу — его нет. */
  private findPrototype(): Located {
    const seen = new Set([this.address]);
    let pending = this.own.pending.get();
    let address = this.own.value.get()?.extends;
    let first: LiveObject | undefined;
    while (address) {
      if (seen.has(address)) return { node: undefined, pending };
      seen.add(address);
      const at = this.tree.locate(address);
      pending ||= at.pending;
      if (!at.node) return { node: first, pending };
      first ??= at.node;
      pending ||= at.node.own.pending.get();
      address = at.node.own.value.get()?.extends;
    }
    return { node: first, pending };
  }

  private readOwn(): { value: OwnObject | undefined; pending: boolean } {
    const reads = new Reads(this.tree.files);
    const index = reads.json(join(this.path, INDEX));
    const metrics = this.readMetrics(reads);
    const actions = this.readActions(reads);
    const directives = this.readDirectives(reads);
    const workflow = this.readWorkflow(reads);
    if (reads.pending) return { value: undefined, pending: true };
    return {
      value: ownObject({
        path: this.path,
        address: this.address,
        folder: this.folder,
        index,
        metrics,
        actions,
        directives,
        workflow,
      }),
      pending: false,
    };
  }

  private readMetrics(reads: Reads): MapMetric[] {
    const dir = join(this.path, METRICS);
    const metrics: MapMetric[] = [];
    for (const entry of reads.list(dir)) {
      if (!entry.isDirectory) continue;
      const metric = ownMetric(
        this.path,
        this.address,
        entry.name,
        reads.json(join(dir, entry.name, CONFIG)),
      );
      if (!metric) continue;
      // Цепочка у каждой метрики своя, поэтому и защита от циклов своя.
      const chain = this.metricChain(reads, metric.config, metric.address, new Set());
      metrics.push({
        ...metric,
        config: chain.config,
        layers: [...metric.layers, ...chain.layers],
      });
    }
    return metrics;
  }

  private readActions(reads: Reads): MapAction[] {
    const dir = join(this.path, ACTIONS);
    const actions: MapAction[] = [];
    for (const entry of reads.list(dir)) {
      if (!entry.isDirectory) continue;
      const action = ownAction(
        this.path,
        this.address,
        entry.name,
        reads.json(join(dir, entry.name, CONFIG)),
      );
      if (!action) continue;
      // Экшон переиспользуется так же, как метрика: `extends` на общий (решение 0038).
      const chain = this.actionChain(reads, action.config, action.address, new Set());
      actions.push({
        ...action,
        config: chain.config,
        layers: [...action.layers, ...chain.layers],
      });
    }
    return actions;
  }

  /**
   * A metric may extend another metric — decision 0004. Its address points at a folder with a
   * `config.json`, which need not live under `_metrics`: that is how one shared metric serves
   * many objects. Слой за слоем, пока `extends` не кончится.
   */
  private metricChain(
    reads: Reads,
    config: MetricConfig,
    self: string,
    seen: Set<string>,
  ): Chain<MetricConfig> {
    const next = this.nextLayer(reads, config.extends, self, seen);
    if (!next || !Check(MetricConfig, next.raw)) return { config, layers: [] };
    const parent = this.metricChain(
      reads,
      anchorDisplay(next.raw, next.layer.path),
      next.layer.address,
      new Set(seen).add(self),
    );
    return { config: mergeMetric(parent.config, config), layers: [next.layer, ...parent.layers] };
  }

  /** Как у метрики: слой за слоем, пока `extends` не кончится. */
  private actionChain(
    reads: Reads,
    config: ActionConfig,
    self: string,
    seen: Set<string>,
  ): Chain<ActionConfig> {
    const next = this.nextLayer(reads, config.extends, self, seen);
    if (!next || !Check(ActionConfig, next.raw)) return { config, layers: [] };
    const parent = this.actionChain(reads, next.raw, next.layer.address, new Set(seen).add(self));
    return { config: mergeAction(parent.config, config), layers: [next.layer, ...parent.layers] };
  }

  /** Куда ведёт `extends`: слой и его `config.json`. Ведёт по кругу или мимо карты — никуда. */
  private nextLayer(
    reads: Reads,
    address: string | undefined,
    self: string,
    seen: Set<string>,
  ): { layer: ConfigLayer; raw: unknown } | undefined {
    if (!address || seen.has(self)) return undefined;
    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map") return undefined;
    const path = join(this.tree.ref.mapPath, ...parsed.path, CONFIG);
    return { layer: { address, path, from: "extends" }, raw: reads.json(path) };
  }

  private readDirectives(reads: Reads): MapFile[] {
    const dir = join(this.path, DIRECTIVES);
    return filesOf(dir, reads.list(dir)).map((file) => {
      const state = reads.text(directiveStatePath(this.path, file.name));
      // Текст самой директивы нужен, только когда есть состояние: с ним и сравнивается.
      return directiveStatus(file, state, state ? reads.text(file.path) : undefined);
    });
  }

  private readWorkflow(reads: Reads): MapStage[] {
    const dir = join(this.path, WORKFLOW);
    return sortStages(
      reads
        .list(dir)
        .filter((entry) => !entry.isDirectory && entry.name.endsWith(".md"))
        .map((entry) => {
          const path = join(dir, entry.name);
          return stageOf(entry.name, path, reads.text(path));
        }),
    );
  }
}

/**
 * Живая карта — одна модель на сторону (решение 0041). Сервер и клиент держат одну и ту же:
 * одинаковые файлы дают одинаковую карту, а отличается только источник файлов.
 */
export class LiveMap {
  readonly root: LiveObject;

  constructor(
    readonly files: LiveFiles,
    readonly ref: LiveMapRef,
  ) {
    this.root = new LiveObject(this, ref.mapPath, MAP_ROOT, ref.name);
  }

  /** Объект по адресу `mapward://`; нет такого — `undefined`. Ищется по папкам, а не обходом. */
  find(address: string): LiveObject | undefined {
    return this.locate(address).node;
  }

  /** Объект по адресу и то, дочитаны ли папки на пути к нему. */
  locate(address: string): Located {
    if (address === MAP_ROOT) return { node: this.root, pending: false };
    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map" || parsed.field) {
      return { node: undefined, pending: false };
    }
    let node: LiveObject | undefined = this.root;
    let pending = false;
    for (const name of parsed.path) {
      if (!node) break;
      pending ||= node.children.pending.get();
      node = node.children.value.get()?.find((child) => child.folder === name);
    }
    return { node, pending };
  }

  /** Вся карта обычными данными; `undefined` — ещё читается. */
  get snapshot(): MapObject | undefined {
    // Значение читается и тогда, когда отдавать его рано: без читателя MobX забыл бы его, и
    // после пачки та же карта собралась бы новым объектом.
    const value = this.root.snapshot.value.get();
    return this.root.snapshot.pending.get() ? undefined : value;
  }

  /** Карта, когда дочитана. Пока читается впервые, одновременные вызовы ждут одно чтение. */
  async current(): Promise<MapObject> {
    // Значение берётся внутри условия: после него наблюдение кончается, и без подписчика
    // карта отпустила бы файлы раньше, чем её прочитали.
    let map: MapObject | undefined;
    await when(() => (map = this.snapshot) !== undefined);
    return map as MapObject;
  }

  /**
   * Карта и дальше каждое её изменение. Пока подписка жива, модель читает и держит всё, что
   * нужно для карты целиком; отписались — файлы отпускаются. Пока пачка дочитывается, карта не
   * уходит; одна и та же карта дважды не уходит.
   */
  watch(listener: (map: MapObject) => void): () => void {
    let last: MapObject | undefined;
    return reaction(
      () => this.snapshot,
      (map) => {
        if (!map || map === last) return;
        last = map;
        listener(map);
      },
      { fireImmediately: true },
    );
  }
}
