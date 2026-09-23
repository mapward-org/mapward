import { computed, reaction, when, type IComputedValue } from "mobx";
import { Check } from "typebox/value";
import { childAddress, MAP_ROOT, parseAddress } from "../model/address.ts";
import { anchorDisplay } from "../model/anchor-display.ts";
import {
  inheritActions,
  inheritDirectives,
  inheritIndex,
  inheritMetrics,
  inheritWorkflow,
  resolveActions,
  resolveIndex,
  resolveMetrics,
  resolver,
  resolveWorkflow,
  type IndexPart,
  type Named,
} from "../model/inherit.ts";
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
  ownIndex,
  ownMetric,
  sortStages,
  stageOf,
  WORKFLOW,
  type FolderEntry,
  type OwnIndex,
} from "../model/raw-object.ts";
import type { Resolve } from "../model/substitution.ts";
import { ActionConfig, MetricConfig } from "../model/schema.ts";
import type { MetricGroup } from "../model/schema.ts";
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
  equals: (a: T | undefined, b: T | undefined) => boolean = sameJson,
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

const EMPTY: never[] = [];

/**
 * Объект живой карты — решения 0041 и 0042. Собирается по частям — индекс, метрики, экшоны,
 * директивы, этапы, — и каждая часть вычисляется из своих файлов и той же части прототипа:
 * чтение имени не тянет директивы, а правка директивы не пересобирает метрики.
 *
 * Снаружи узел выглядит как `MapObject`: его поля — геттеры частей, поэтому любой код, который
 * умеет читать объект карты, читает и узел, а подписывается ровно на то, что прочитал.
 */
export class LiveObject implements MapObject {
  private readonly nodes = new Map<string, LiveObject>();

  /** Своё — как написано в файлах, частями. */
  readonly own: {
    index: Settled<OwnIndex>;
    metrics: Settled<MapMetric[]>;
    actions: Settled<MapAction[]>;
    directives: Settled<MapFile[]>;
    workflow: Settled<MapStage[]>;
  };
  /** Дети — объекты и группы из подпапок, в порядке папки. */
  readonly nodesOf: Settled<LiveObject[]>;
  /** Прототип по `extends`; цепочка по кругу прототипа не даёт. */
  readonly prototype: IComputedValue<Located>;
  /** После наследования, до подстановок, частями. */
  readonly inherited: {
    index: Settled<IndexPart>;
    metrics: Settled<MapMetric[]>;
    actions: Settled<MapAction[]>;
    directives: Settled<MapFile[]>;
    workflow: Settled<MapStage[]>;
  };
  /** После подстановок — то, что видят сайдбар и агент. */
  readonly resolved: {
    index: Settled<IndexPart>;
    metrics: Settled<MapMetric[]>;
    actions: Settled<MapAction[]>;
    workflow: Settled<MapStage[]>;
  };
  /** Объект вместе с детьми обычными данными: так его отдают агенту и серверу. */
  readonly snapshot: Settled<MapObject>;

  constructor(
    private readonly tree: LiveMap,
    readonly path: string,
    readonly address: string,
    /** Имя папки: по нему объект ищется у родителя и зовётся, если своего имени нет. */
    readonly folder: string,
  ) {
    const own = (read: (reads: Reads) => unknown) =>
      settled(() => {
        const reads = new Reads(tree.files);
        const value = read(reads);
        return reads.pending ? { value: undefined, pending: true } : { value, pending: false };
      });

    this.own = {
      index: own((reads) =>
        ownIndex({ path, address, folder, index: reads.json(join(path, INDEX)) }),
      ) as Settled<OwnIndex>,
      metrics: own((reads) => this.readMetrics(reads)) as Settled<MapMetric[]>,
      actions: own((reads) => this.readActions(reads)) as Settled<MapAction[]>,
      directives: own((reads) => this.readDirectives(reads)) as Settled<MapFile[]>,
      workflow: own((reads) => this.readWorkflow(reads)) as Settled<MapStage[]>,
    };
    // Те же объекты в том же порядке — те же дети: пустая новая папка карты не меняет.
    this.nodesOf = settled(() => this.readChildren(), sameItems);
    this.prototype = computed(() => this.findPrototype(), { equals: sameLocated });

    /**
     * Часть после наследования: своя часть поверх той же части прототипа. Прототипа нет —
     * своя как есть; прототип есть, но его часть ещё не собрана — ждём.
     */
    const inherit = <T, P>(
      mine: Settled<T>,
      theirs: (prototype: LiveObject) => Settled<P>,
      combine: (own: T, prototype: { address: string; value: P } | undefined) => unknown,
    ) =>
      settled(() => {
        const value = mine.value.get();
        const at = this.prototype.get();
        const base = at.node ? theirs(at.node) : undefined;
        const pending = mine.pending.get() || at.pending || (base?.pending.get() ?? false);
        if (value === undefined) return { value: undefined, pending: true };
        if (!at.node || !base) return { value: combine(value, undefined), pending };
        const prototype = base.value.get();
        if (prototype === undefined) return { value: undefined, pending: true };
        return { value: combine(value, { address: at.node.address, value: prototype }), pending };
      });

    const place = { address, path };
    this.inherited = {
      index: inherit(
        this.own.index,
        (node) => node.inherited.index,
        (index: OwnIndex, prototype: { value: IndexPart } | undefined) =>
          inheritIndex(index, prototype?.value),
      ) as Settled<IndexPart>,
      metrics: inherit(
        this.own.metrics,
        (node) => node.inherited.metrics,
        (metrics: MapMetric[], prototype: { address: string; value: MapMetric[] } | undefined) =>
          inheritMetrics(
            place,
            metrics,
            prototype && { address: prototype.address, metrics: prototype.value },
          ),
      ) as Settled<MapMetric[]>,
      actions: inherit(
        this.own.actions,
        (node) => node.inherited.actions,
        (actions: MapAction[], prototype: { address: string; value: MapAction[] } | undefined) =>
          inheritActions(
            place,
            actions,
            prototype && { address: prototype.address, actions: prototype.value },
          ),
      ) as Settled<MapAction[]>,
      directives: inherit(
        this.own.directives,
        (node) => node.inherited.directives,
        (directives: MapFile[], prototype: { address: string; value: MapFile[] } | undefined) =>
          inheritDirectives(
            directives,
            prototype && { address: prototype.address, directives: prototype.value },
          ),
      ) as Settled<MapFile[]>,
      workflow: inherit(
        this.own.workflow,
        (node) => node.inherited.workflow,
        // Заменять ли унаследованные этапы, говорит индекс объекта: он читается здесь же, и
        // этапы пересобираются, когда поменялся режим.
        (workflow: MapStage[], prototype: { address: string; value: MapStage[] } | undefined) =>
          inheritWorkflow(
            workflow,
            this.own.index.value.get()?.workflowMode,
            prototype && { address: prototype.address, workflow: prototype.value },
          ),
      ) as Settled<MapStage[]>,
    };

    /**
     * Подстановки ищут цели по адресу и берут у них собранный индекс. Цель ещё читается —
     * ответ посчитан, но не окончательный.
     */
    const substituted = <T>(part: Settled<T>, apply: (value: T, at: Resolve) => T): Settled<T> =>
      settled(() => {
        const value = part.value.get();
        const self = this.inherited.index.value.get();
        let pending = part.pending.get() || this.inherited.index.pending.get();
        if (value === undefined || self === undefined) return { value: undefined, pending: true };
        const find = (target: string): Named | undefined => {
          const at = this.tree.locate(target);
          if (at.pending || (at.node !== undefined && at.node.inherited.index.pending.get())) {
            pending = true;
          }
          return at.node?.inherited.index.value.get();
        };
        return {
          value: apply(value, resolver(find, self, this.tree.ref.basePath)),
          pending,
        };
      });

    this.resolved = {
      index: substituted(this.inherited.index, resolveIndex),
      metrics: substituted(this.inherited.metrics, resolveMetrics),
      actions: substituted(this.inherited.actions, resolveActions),
      workflow: settled(() => {
        const workflow = this.inherited.workflow.value.get();
        return {
          value: workflow === undefined ? undefined : resolveWorkflow(workflow),
          pending: this.inherited.workflow.pending.get(),
        };
      }),
    };

    this.snapshot = settled(() => {
      const index = this.resolved.index.value.get();
      const metrics = this.resolved.metrics.value.get();
      const actions = this.resolved.actions.value.get();
      const directives = this.inherited.directives.value.get();
      const workflow = this.resolved.workflow.value.get();
      const children = this.nodesOf.value.get();
      let pending =
        this.resolved.index.pending.get() ||
        this.resolved.metrics.pending.get() ||
        this.resolved.actions.pending.get() ||
        this.inherited.directives.pending.get() ||
        this.resolved.workflow.pending.get() ||
        this.nodesOf.pending.get();
      if (!index || !metrics || !actions || !directives || !workflow || !children) {
        return { value: undefined, pending: true };
      }
      const snapshots: MapObject[] = [];
      for (const child of children) {
        const snapshot = child.snapshot.value.get();
        if (child.snapshot.pending.get()) pending = true;
        if (!snapshot) return { value: undefined, pending: true };
        snapshots.push(snapshot);
      }
      return {
        value: { ...index, metrics, actions, directives, workflow, children: snapshots },
        pending,
      };
    }, sameSnapshot);
  }

  // Поля объекта карты — геттеры частей. Пока часть не пришла, поле пустое, а не падает: так
  // его можно рисовать сразу, а готовность спрашивать у `ready`.

  private get index(): IndexPart | undefined {
    return this.resolved.index.value.get();
  }

  get name(): string {
    return this.index?.name ?? this.folder;
  }

  get prototypeName(): string | undefined {
    return this.index?.prototypeName;
  }

  get isGroup(): boolean {
    return this.index?.isGroup ?? false;
  }

  get props(): Record<string, unknown> {
    return this.index?.props ?? {};
  }

  get previewSize(): MapObject["previewSize"] {
    return this.index?.previewSize;
  }

  get previewLayout(): MapObject["previewLayout"] {
    return this.index?.previewLayout;
  }

  get detailsLayout(): MapObject["detailsLayout"] {
    return this.index?.detailsLayout;
  }

  get previewStyle(): MapObject["previewStyle"] {
    return this.index?.previewStyle;
  }

  get layers(): ConfigLayer[] {
    return this.index?.layers ?? EMPTY;
  }

  get prompt(): string | undefined {
    return this.index?.prompt;
  }

  get workflowPrompt(): string | undefined {
    return this.index?.workflowPrompt;
  }

  get workflowMode(): MapObject["workflowMode"] {
    return this.index?.workflowMode;
  }

  get metricGroups(): MetricGroup[] {
    return this.index?.metricGroups ?? EMPTY;
  }

  get metricGroupsMode(): MapObject["metricGroupsMode"] {
    return this.index?.metricGroupsMode;
  }

  get metrics(): MapMetric[] {
    return this.resolved.metrics.value.get() ?? EMPTY;
  }

  get actions(): MapAction[] {
    return this.resolved.actions.value.get() ?? EMPTY;
  }

  get directives(): MapFile[] {
    return this.inherited.directives.value.get() ?? EMPTY;
  }

  get workflow(): MapStage[] {
    return this.resolved.workflow.value.get() ?? EMPTY;
  }

  get children(): LiveObject[] {
    return this.nodesOf.value.get() ?? EMPTY;
  }

  /** Индекс объекта прочитан: имя, свойства и вкладки — уже настоящие. */
  get ready(): boolean {
    const index = this.resolved.index.value.get();
    return index !== undefined && !this.resolved.index.pending.get();
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
    let pending = this.own.index.pending.get();
    let address = this.own.index.value.get()?.extends;
    let first: LiveObject | undefined;
    while (address) {
      if (seen.has(address)) return { node: undefined, pending };
      seen.add(address);
      const at = this.tree.locate(address);
      pending ||= at.pending;
      if (!at.node) return { node: first, pending };
      first ??= at.node;
      pending ||= at.node.own.index.pending.get();
      address = at.node.own.index.value.get()?.extends;
    }
    return { node: first, pending };
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
      pending ||= node.nodesOf.pending.get();
      node = node.nodesOf.value.get()?.find((child) => child.folder === name);
    }
    return { node, pending };
  }

  /**
   * Предки объекта от корня, без него самого: для крошек. Читаются только папки на пути и
   * индексы предков — остальная карта не нужна.
   */
  ancestors(address: string): LiveObject[] {
    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map" || address === MAP_ROOT) return [];
    const chain: LiveObject[] = [this.root];
    let node: LiveObject | undefined = this.root;
    for (const name of parsed.path.slice(0, -1)) {
      node = node?.nodesOf.value.get()?.find((child) => child.folder === name);
      if (!node) break;
      chain.push(node);
    }
    return chain;
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
