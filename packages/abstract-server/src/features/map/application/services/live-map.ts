import { combineLatest, firstValueFrom, map, Observable, of } from "rxjs";
import { Check } from "typebox/value";
import {
  ACTIONS,
  childAddress,
  CONFIG,
  DIRECTIVES,
  INDEX,
  MAP_ROOT,
  METRICS,
  parseAddress,
  WORKFLOW,
  type ConfigLayer,
  type MapAction,
  type MapFile,
  type MapMetric,
  type MapObject,
  type MapStage,
} from "@mapward/core";
import { anchorAction, anchorDisplay } from "../../domain/anchor-display.ts";
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
} from "../../domain/inherit.ts";
import { mergeAction, mergeMetric } from "../../domain/merge.ts";
import { directiveStatePath } from "../../../../kernel/directives.ts";
import {
  directiveStatus,
  filesOf,
  isService,
  ownAction,
  ownIndex,
  ownMetric,
  sortStages,
  stageOf,
  type OwnIndex,
} from "../../domain/raw-object.ts";
import type { Resolve } from "../../domain/substitution.ts";
import { ActionConfig, MetricConfig } from "../../domain/schema.ts";
import { join } from "../../../../lib/path.ts";
import {
  cached,
  every,
  follow,
  isReady,
  mapReady,
  PENDING,
  sameJson,
  settle,
  type Maybe,
  type LiveFiles,
} from "@mapward/vfs";

/** Какая карта: папка, корень проекта для `@` и имя корня. */
export type LiveMapRef = { mapPath: string; basePath: string; name: string };

type Chain<T> = { config: T; layers: ConfigLayer[] };

/** Узел карты — папка объекта. Тот же узел, пока папка на месте: по нему сверяют детей. */
export class LiveNode {
  private readonly nodes = new Map<string, LiveNode>();

  constructor(
    readonly path: string,
    readonly address: string,
    /** Имя папки: по нему объект ищется у родителя и зовётся, если своего имени нет. */
    readonly folder: string,
  ) {}

  child(name: string): LiveNode {
    const existing = this.nodes.get(name);
    if (existing) return existing;
    const created = new LiveNode(join(this.path, name), childAddress(this.address, name), name);
    this.nodes.set(name, created);
    return created;
  }
}

const sameNode = (a: Maybe<LiveNode | undefined>, b: Maybe<LiveNode | undefined>) => a === b;

const sameNodes = (a: Maybe<LiveNode[]>, b: Maybe<LiveNode[]>) =>
  a === b ||
  (isReady(a) &&
    isReady(b) &&
    a.length === b.length &&
    a.every((node, index) => node === b[index]));

/** Снимок тот же, если своё то же и дети — те же объекты: неизменённая ветка не рисуется. */
const sameSnapshot = (a: Maybe<MapObject>, b: Maybe<MapObject>) =>
  a === b ||
  (isReady(a) &&
    isReady(b) &&
    a.children.length === b.children.length &&
    a.children.every((child, index) => child === b.children[index]) &&
    sameJson({ ...a, children: [] }, { ...b, children: [] }));

/**
 * Поиск по адресам с повтором, пока набор целей не перестанет расти: подстановка берёт поле у
 * цели, а поле цели само бывает выражением со своей целью. Цель, которая ещё не ответила, —
 * `PENDING` на выходе. Целей, которые больше не нужны, поток отпускает.
 */
function lookup<T>(
  compute: (find: (address: string) => Named | undefined) => T,
  target: (address: string) => Observable<Maybe<Named | undefined>>,
): Observable<Maybe<T>> {
  return new Observable<Maybe<T>>((subscriber) => {
    const held = new Map<string, { value: Maybe<Named | undefined>; stop: () => void }>();
    let running = false;
    let again = false;

    const hold = (address: string) => {
      if (held.has(address)) return;
      const entry = { value: PENDING as Maybe<Named | undefined>, stop: () => {} };
      held.set(address, entry);
      const subscription = target(address).subscribe((value) => {
        entry.value = value;
        run();
      });
      entry.stop = () => subscription.unsubscribe();
    };

    const run = () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          const asked = new Set<string>();
          let missing = false;
          const result = compute((address) => {
            asked.add(address);
            hold(address);
            const value = held.get(address)?.value ?? PENDING;
            if (!isReady(value)) {
              missing = true;
              return undefined;
            }
            return value;
          });
          for (const [address, entry] of held) {
            if (asked.has(address)) continue;
            entry.stop();
            held.delete(address);
          }
          if (!again) subscriber.next(missing ? PENDING : result);
        } while (again);
      } finally {
        running = false;
      }
    };

    run();
    return () => {
      for (const entry of held.values()) entry.stop();
      held.clear();
    };
  });
}

/**
 * Живая карта — граф потоков (решение 0041, переписано на rxjs). Каждый файл — свой поток;
 * объект собирается слоями, и у каждого слоя свой поток на адрес: своё — из файлов, собранное —
 * из своего и собранного прототипа, с подстановками — из собранного и целей. Слой подписывается
 * ровно на то, что читает, поэтому правка директивы не пересобирает метрики.
 *
 * Потоки заводятся лениво и отпускаются, когда их никто не слушает.
 */
export class LiveMap {
  readonly root: LiveNode;
  private readonly streams = new Map<string, Observable<unknown>>();

  constructor(
    readonly files: LiveFiles,
    readonly ref: LiveMapRef,
  ) {
    this.root = new LiveNode(ref.mapPath, MAP_ROOT, ref.name);
  }

  private memo<T>(
    key: string,
    make: () => Observable<T>,
    equals?: (a: T, b: T) => boolean,
  ): Observable<T> {
    return cached(this.streams as Map<string, Observable<T>>, key, make, equals);
  }

  // ---- Узлы: папки карты ----

  /** Дети — объекты и группы из подпапок, в порядке папки. */
  nodes$(node: LiveNode): Observable<Maybe<LiveNode[]>> {
    return this.memo(
      `nodes|${node.path}`,
      () =>
        this.files
          .list$(node.path)
          .pipe(
            mapReady((entries) =>
              entries
                .filter((entry) => entry.isDirectory && !isService(entry.name))
                .map((entry) => node.child(entry.name)),
            ),
          ),
      sameNodes,
    );
  }

  /** Узел по адресу; нет такого — `undefined`. Ищется по папкам на пути, а не обходом. */
  locate$(address: string): Observable<Maybe<LiveNode | undefined>> {
    if (address === MAP_ROOT) return of(this.root);
    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map" || parsed.field) return of(undefined);
    return this.memo(
      `locate|${address}`,
      () => {
        let at: Observable<Maybe<LiveNode | undefined>> = of(this.root);
        for (const name of parsed.path) {
          at = at.pipe(
            follow((node) =>
              node === undefined
                ? of(undefined)
                : this.nodes$(node).pipe(
                    mapReady((children) => children.find((child) => child.folder === name)),
                  ),
            ),
          );
        }
        return at;
      },
      sameNode,
    );
  }

  // ---- Своё: как написано в файлах ----

  ownIndex$(node: LiveNode): Observable<Maybe<OwnIndex>> {
    return this.memo(`own-index|${node.path}`, () =>
      this.files
        .json$(join(node.path, INDEX))
        .pipe(
          mapReady((index) =>
            ownIndex({ path: node.path, address: node.address, folder: node.folder, index }),
          ),
        ),
    );
  }

  private ownMetrics$(node: LiveNode): Observable<Maybe<MapMetric[]>> {
    const dir = join(node.path, METRICS);
    return this.memo(`own-metrics|${node.path}`, () =>
      this.files.list$(dir).pipe(
        follow((entries) =>
          every(
            entries
              .filter((entry) => entry.isDirectory)
              .map((entry) =>
                this.files.json$(join(dir, entry.name, CONFIG)).pipe(
                  follow((raw): Observable<Maybe<MapMetric | undefined>> => {
                    const metric = ownMetric(node.path, node.address, entry.name, raw);
                    if (!metric) return of(undefined);
                    // Цепочка у каждой метрики своя, поэтому и защита от циклов своя.
                    return this.metricChain$(metric.config, metric.address, new Set()).pipe(
                      mapReady((chain) => ({
                        ...metric,
                        config: chain.config,
                        layers: [...metric.layers, ...chain.layers],
                      })),
                    );
                  }),
                ),
              ),
          ),
        ),
        mapReady((metrics) => metrics.filter((metric) => metric !== undefined)),
      ),
    );
  }

  private ownActions$(node: LiveNode): Observable<Maybe<MapAction[]>> {
    const dir = join(node.path, ACTIONS);
    return this.memo(`own-actions|${node.path}`, () =>
      this.files.list$(dir).pipe(
        follow((entries) =>
          every(
            entries
              .filter((entry) => entry.isDirectory)
              .map((entry) =>
                this.files.json$(join(dir, entry.name, CONFIG)).pipe(
                  follow((raw): Observable<Maybe<MapAction | undefined>> => {
                    const action = ownAction(node.path, node.address, entry.name, raw);
                    if (!action) return of(undefined);
                    // Экшон переиспользуется так же, как метрика: `extends` на общий (0038).
                    return this.actionChain$(action.config, action.address, new Set()).pipe(
                      mapReady((chain) => ({
                        ...action,
                        config: chain.config,
                        layers: [...action.layers, ...chain.layers],
                      })),
                    );
                  }),
                ),
              ),
          ),
        ),
        mapReady((actions) => actions.filter((action) => action !== undefined)),
      ),
    );
  }

  /**
   * A metric may extend another metric — decision 0004. Its address points at a folder with a
   * `config.json`, which need not live under `_metrics`: that is how one shared metric serves
   * many objects. Слой за слоем, пока `extends` не кончится; круг обрывается по `seen`, а не
   * подпиской на самого себя.
   */
  private metricChain$(
    config: MetricConfig,
    self: string,
    seen: Set<string>,
  ): Observable<Maybe<Chain<MetricConfig>>> {
    const next = this.nextLayer(config.extends, self, seen);
    if (!next) return of({ config, layers: [] });
    return this.files.json$(next.path).pipe(
      follow((raw): Observable<Maybe<Chain<MetricConfig>>> => {
        if (!Check(MetricConfig, raw)) return of({ config, layers: [] });
        return this.metricChain$(
          anchorDisplay(raw, next.path),
          next.layer.address,
          new Set(seen).add(self),
        ).pipe(
          mapReady((parent) => ({
            config: mergeMetric(parent.config, config),
            layers: [next.layer, ...parent.layers],
          })),
        );
      }),
    );
  }

  /** Как у метрики: слой за слоем, пока `extends` не кончится. */
  private actionChain$(
    config: ActionConfig,
    self: string,
    seen: Set<string>,
  ): Observable<Maybe<Chain<ActionConfig>>> {
    const next = this.nextLayer(config.extends, self, seen);
    if (!next) return of({ config, layers: [] });
    return this.files.json$(next.path).pipe(
      follow((raw): Observable<Maybe<Chain<ActionConfig>>> => {
        if (!Check(ActionConfig, raw)) return of({ config, layers: [] });
        return this.actionChain$(
          anchorAction(raw, next.path),
          next.layer.address,
          new Set(seen).add(self),
        ).pipe(
          mapReady((parent) => ({
            config: mergeAction(parent.config, config),
            layers: [next.layer, ...parent.layers],
          })),
        );
      }),
    );
  }

  /** Куда ведёт `extends`: слой и путь его `config.json`. Ведёт по кругу или мимо карты — никуда. */
  private nextLayer(
    address: string | undefined,
    self: string,
    seen: Set<string>,
  ): { layer: ConfigLayer; path: string } | undefined {
    if (!address || seen.has(self)) return undefined;
    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map") return undefined;
    const path = join(this.ref.mapPath, ...parsed.path, CONFIG);
    return { layer: { address, path, from: "extends" }, path };
  }

  private ownDirectives$(node: LiveNode): Observable<Maybe<MapFile[]>> {
    const dir = join(node.path, DIRECTIVES);
    return this.memo(`own-directives|${node.path}`, () =>
      this.files.list$(dir).pipe(
        follow((entries) =>
          every(
            filesOf(dir, entries).map((file) =>
              this.files.text$(directiveStatePath(node.path, file.name)).pipe(
                // Текст самой директивы нужен, только когда есть состояние: с ним и сравнивается.
                follow((state) =>
                  state
                    ? this.files
                        .text$(file.path)
                        .pipe(mapReady((text) => directiveStatus(file, state, text)))
                    : of(directiveStatus(file, state, undefined)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  private ownWorkflow$(node: LiveNode): Observable<Maybe<MapStage[]>> {
    const dir = join(node.path, WORKFLOW);
    return this.memo(`own-workflow|${node.path}`, () =>
      this.files.list$(dir).pipe(
        follow((entries) =>
          every(
            entries
              .filter((entry) => !entry.isDirectory && entry.name.endsWith(".md"))
              .map((entry) => {
                const path = join(dir, entry.name);
                return this.files
                  .text$(path)
                  .pipe(mapReady((text) => stageOf(entry.name, path, text)));
              }),
          ),
        ),
        mapReady(sortStages),
      ),
    );
  }

  // ---- Наследование ----

  /**
   * Прототип по `extends` — первый объект цепочки. Цепочка обходится до конца ради одного:
   * узнать, не ведёт ли она по кругу. По кругу — прототипа нет вовсе, а не бесконечная подписка.
   */
  prototype$(node: LiveNode): Observable<Maybe<LiveNode | undefined>> {
    const walk = (
      address: string | undefined,
      seen: Set<string>,
      first: LiveNode | undefined,
    ): Observable<Maybe<LiveNode | undefined>> => {
      if (!address) return of(first);
      if (seen.has(address)) return of(undefined);
      return this.locate$(address).pipe(
        follow((found) =>
          found === undefined
            ? of(first)
            : this.ownIndex$(found).pipe(
                follow((index) => walk(index.extends, new Set(seen).add(address), first ?? found)),
              ),
        ),
      );
    };
    return this.memo(
      `prototype|${node.path}`,
      () =>
        this.ownIndex$(node).pipe(
          follow((index) => walk(index.extends, new Set([node.address]), undefined)),
        ),
      sameNode,
    );
  }

  /**
   * Часть после наследования: своя поверх той же части прототипа. Прототипа нет — своя как
   * есть. Рекурсия по прототипу конечна: круг `prototype$` уже отрезал.
   */
  private inherit<T, P>(
    part: string,
    node: LiveNode,
    mine: Observable<Maybe<T>>,
    theirs: (prototype: LiveNode) => Observable<Maybe<P>>,
    combine: (own: T, prototype: { address: string; value: P } | undefined) => unknown,
  ): Observable<Maybe<unknown>> {
    return this.memo(`inherited-${part}|${node.path}`, () =>
      combineLatest([mine, this.prototype$(node)]).pipe(
        map(([own, prototype]) =>
          isReady(own) && isReady(prototype) ? { own, prototype } : PENDING,
        ),
        follow(({ own, prototype }) =>
          prototype === undefined
            ? of(combine(own, undefined))
            : theirs(prototype).pipe(
                mapReady((value) => combine(own, { address: prototype.address, value })),
              ),
        ),
      ),
    );
  }

  inheritedIndex$(node: LiveNode): Observable<Maybe<IndexPart>> {
    return this.inherit(
      "index",
      node,
      this.ownIndex$(node),
      (prototype) => this.inheritedIndex$(prototype),
      (index: OwnIndex, prototype: { value: IndexPart } | undefined) =>
        inheritIndex(index, prototype?.value),
    ) as Observable<Maybe<IndexPart>>;
  }

  private inheritedMetrics$(node: LiveNode): Observable<Maybe<MapMetric[]>> {
    const place = { address: node.address, path: node.path };
    return this.inherit(
      "metrics",
      node,
      this.ownMetrics$(node),
      (prototype) => this.inheritedMetrics$(prototype),
      (metrics: MapMetric[], prototype: { address: string; value: MapMetric[] } | undefined) =>
        inheritMetrics(
          place,
          metrics,
          prototype && { address: prototype.address, metrics: prototype.value },
        ),
    ) as Observable<Maybe<MapMetric[]>>;
  }

  private inheritedActions$(node: LiveNode): Observable<Maybe<MapAction[]>> {
    const place = { address: node.address, path: node.path };
    return this.inherit(
      "actions",
      node,
      this.ownActions$(node),
      (prototype) => this.inheritedActions$(prototype),
      (actions: MapAction[], prototype: { address: string; value: MapAction[] } | undefined) =>
        inheritActions(
          place,
          actions,
          prototype && { address: prototype.address, actions: prototype.value },
        ),
    ) as Observable<Maybe<MapAction[]>>;
  }

  private inheritedDirectives$(node: LiveNode): Observable<Maybe<MapFile[]>> {
    return this.inherit(
      "directives",
      node,
      this.ownDirectives$(node),
      (prototype) => this.inheritedDirectives$(prototype),
      (directives: MapFile[], prototype: { address: string; value: MapFile[] } | undefined) =>
        inheritDirectives(
          directives,
          prototype && { address: prototype.address, directives: prototype.value },
        ),
    ) as Observable<Maybe<MapFile[]>>;
  }

  private inheritedWorkflow$(node: LiveNode): Observable<Maybe<MapStage[]>> {
    // Заменять ли унаследованные этапы, говорит индекс объекта: он читается здесь же, и этапы
    // пересобираются, когда поменялся режим.
    const mine = combineLatest([this.ownWorkflow$(node), this.ownIndex$(node)]).pipe(
      map(([workflow, index]) =>
        isReady(workflow) && isReady(index) ? { workflow, mode: index.workflowMode } : PENDING,
      ),
    );
    return this.inherit(
      "workflow",
      node,
      mine,
      (prototype) => this.inheritedWorkflow$(prototype),
      (
        own: { workflow: MapStage[]; mode: MapObject["workflowMode"] },
        prototype: { address: string; value: MapStage[] } | undefined,
      ) =>
        inheritWorkflow(
          own.workflow,
          own.mode,
          prototype && { address: prototype.address, workflow: prototype.value },
        ),
    ) as Observable<Maybe<MapStage[]>>;
  }

  // ---- Подстановки ----

  /**
   * Подстановки ищут цели по адресу и берут у них собранный индекс. Набор целей узнаётся из
   * самих выражений, поэтому поиск — с повтором, пока он не перестанет расти.
   */
  private substituted<T>(
    part: string,
    node: LiveNode,
    value$: Observable<Maybe<T>>,
    apply: (value: T, at: Resolve) => T,
  ): Observable<Maybe<T>> {
    return this.memo(`resolved-${part}|${node.path}`, () =>
      combineLatest([value$, this.inheritedIndex$(node)]).pipe(
        map(([value, self]) => (isReady(value) && isReady(self) ? { value, self } : PENDING)),
        follow(({ value, self }) =>
          lookup(
            (find) => apply(value, resolver(find, self, this.ref.basePath)),
            (address) =>
              this.locate$(address).pipe(
                follow((found) =>
                  found === undefined ? of(undefined) : this.inheritedIndex$(found),
                ),
              ),
          ),
        ),
      ),
    );
  }

  /** Индекс после наследования и подстановок: имя, свойства, вкладки. */
  index$(node: LiveNode): Observable<Maybe<IndexPart>> {
    return this.substituted("index", node, this.inheritedIndex$(node), resolveIndex);
  }

  // ---- Снимок ----

  /** Объект вместе с детьми обычными данными: так его отдают агенту, клиенту и серверу. */
  private snapshot$(node: LiveNode): Observable<Maybe<MapObject>> {
    return this.memo(
      `snapshot|${node.path}`,
      () =>
        combineLatest([this.object$(node), this.nodes$(node)]).pipe(
          map(([object, nodes]) =>
            isReady(object) && isReady(nodes) ? { object, nodes } : PENDING,
          ),
          follow(({ object, nodes }) =>
            every(nodes.map((child) => this.snapshot$(child))).pipe(
              mapReady((children): MapObject => ({ ...object, children })),
            ),
          ),
        ),
      sameSnapshot,
    );
  }

  /**
   * Сам объект без детей: своё после наследования и подстановок. Дети в нём пустые — их
   * снимки отдаёт `snapshot$`, а `shallow$` прикладывает их без внуков.
   */
  object$(node: LiveNode): Observable<Maybe<MapObject>> {
    return this.memo(`object|${node.path}`, () =>
      combineLatest([
        this.index$(node),
        this.substituted("metrics", node, this.inheritedMetrics$(node), resolveMetrics),
        this.substituted("actions", node, this.inheritedActions$(node), resolveActions),
        this.inheritedDirectives$(node),
        this.inheritedWorkflow$(node).pipe(mapReady(resolveWorkflow)),
      ]).pipe(
        map(([index, metrics, actions, directives, workflow]) =>
          isReady(index) &&
          isReady(metrics) &&
          isReady(actions) &&
          isReady(directives) &&
          isReady(workflow)
            ? {
                ...index,
                metrics,
                actions,
                directives,
                workflow,
                children: [],
              }
            : PENDING,
        ),
      ),
    );
  }

  /**
   * Объект с детьми без внуков — то, что нужно экрану объекта: свои поля и ближайшие дети с их
   * полями. Поддерево целиком так не читается.
   */
  shallow$(node: LiveNode): Observable<Maybe<MapObject>> {
    return this.tree$(node, 1);
  }

  /**
   * Объект и дети на `depth` уровней вниз; на последнем — без своих детей. Глубже не читается
   * ничего: правка под этим уровнем такой поток не будит. `0` — сам объект, как `object$`.
   */
  tree$(node: LiveNode, depth: number): Observable<Maybe<MapObject>> {
    if (depth <= 0) return this.object$(node);
    return this.memo(
      `tree-${depth}|${node.path}`,
      () =>
        combineLatest([this.object$(node), this.nodes$(node)]).pipe(
          map(([object, nodes]) =>
            isReady(object) && isReady(nodes) ? { object, nodes } : PENDING,
          ),
          follow(({ object, nodes }) =>
            every(nodes.map((child) => this.tree$(child, depth - 1))).pipe(
              mapReady((children): MapObject => ({ ...object, children })),
            ),
          ),
        ),
      sameSnapshot,
    );
  }

  // ---- Наружу ----

  /** Объект по адресу с детьми без внуков; нет такого — `undefined`. */
  view$(address: string): Observable<MapObject | undefined> {
    return this.subtree$(address, 1);
  }

  /**
   * Объект по адресу и дальше каждое его изменение — одно значение на пачку, только готовое;
   * нет такого — `undefined`. `depth` — сколько уровней детей приложить: `0` — без детей, `1` —
   * дети без внуков, `Infinity` — всё под ним. Глубина обязательна и умолчания «всё» нет: всё
   * поддерево держит прочитанным и под вотчером всё, что под адресом, а от корня — всю карту, и
   * просить его надо явно. Читается только путь к объекту и то, что под ним на этой глубине.
   */
  subtree$(address: string, depth: number): Observable<MapObject | undefined> {
    return this.locate$(address).pipe(
      follow((node) =>
        node === undefined
          ? of(undefined)
          : depth === Infinity
            ? this.snapshot$(node)
            : this.tree$(node, depth),
      ),
      settle<MapObject | undefined>(
        (a, b) => a === b || (a !== undefined && b !== undefined && sameSnapshot(a, b)),
      ),
    );
  }

  /** То же разово: объект, когда дочитан. */
  subtree(address: string, depth: number): Promise<MapObject | undefined> {
    return firstValueFrom(this.subtree$(address, depth));
  }

  /** Предки объекта от корня, без него самого: для крошек. Читаются только папки на пути. */
  /**
   * Родители объекта от корня, без него самого: только объекты, то есть папки с `_index.json`.
   * Полка — папка без индекса — родителем не считается: объекта за ней нет, уход в неё открывал
   * бы экран ни о чём. Родителем объекта поэтому оказывается ближайший объект выше, а не
   * ближайшая папка, — и в крошках, и в `parents` у агента. Читаются только папки на пути.
   */
  ancestors$(address: string): Observable<{ address: string; name: string }[]> {
    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map" || address === MAP_ROOT) return of([]);
    const chain = [MAP_ROOT];
    let at = MAP_ROOT;
    for (const name of parsed.path.slice(0, -1)) {
      at = childAddress(at, name);
      chain.push(at);
    }
    return every(
      chain.map((ancestor) =>
        this.locate$(ancestor).pipe(
          follow((node) =>
            node === undefined
              ? of(undefined)
              : this.index$(node).pipe(
                  mapReady((index) =>
                    index.isGroup
                      ? undefined
                      : { address: node.address, name: index.name ?? node.folder },
                  ),
                ),
          ),
        ),
      ),
    ).pipe(
      mapReady((found) => found.filter((entry) => entry !== undefined)),
      settle(),
    );
  }
}
