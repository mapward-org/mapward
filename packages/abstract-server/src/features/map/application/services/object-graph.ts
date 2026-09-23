import { combineLatest, map, of, switchMap, type Observable } from "rxjs";
import { Check } from "typebox/value";
import { ActionConfig, childAddress, MetricConfig, parseAddress } from "@mapward/core";
import type { ConfigLayer, MapAction, MapFile, MapMetric, MapStage } from "@mapward/core";
import { join } from "../../../../lib/path.ts";
import { anchorDisplay } from "../../domain/anchor-display.ts";
import { mergeAction, mergeMetric } from "../../domain/merge.ts";
import {
  ACTIONS,
  CONFIG,
  DIRECTIVES,
  directiveStatus,
  filesOf,
  INDEX,
  isService,
  METRICS,
  ownAction,
  ownMetric,
  rawObject,
  sortStages,
  stageOf,
  WORKFLOW,
  type Raw,
} from "../../domain/raw-object.ts";
import { directiveStatePath } from "../../../../kernel/directive-files.ts";
import type { FileStore } from "./file-store.ts";

/** `combineLatest` пустого списка молчит, а пустой список — тоже ответ. */
const all = <T>(streams: Observable<T>[]): Observable<T[]> =>
  streams.length === 0 ? of([]) : combineLatest(streams);

const defined = <T>(items: (T | undefined)[]): T[] =>
  items.filter((item): item is T => item !== undefined);

type Chain<T> = { config: T; layers: ConfigLayer[] };

/**
 * Граф карты — середина реактивной модели (решение 0041): объект собран из потоков своих
 * файлов, и поток объекта пересобирается, только когда изменился один из них. Куда ведёт
 * цепочка `extends` у метрики и экшона, зависит от содержимого: поменяли `extends` — объект
 * переподписывается на другой слой.
 *
 * Наследование объектов и подстановки здесь не считаются: они ищут по всей карте, и граф их
 * отдаёт сборке целиком, а она чистая и синхронная.
 */
export class ObjectGraph {
  constructor(
    private readonly store: FileStore,
    private readonly mapPath: string,
  ) {}

  /** Прочитанный объект вместе с детьми. */
  object(path: string, address: string, folder: string): Observable<Raw> {
    return combineLatest([this.store.json(join(path, INDEX)), this.store.list(path)]).pipe(
      switchMap(([index, entries]) =>
        combineLatest([
          // Depth first: children are read in the order they will be listed.
          all(
            entries
              .filter((entry) => entry.isDirectory && !isService(entry.name))
              .map((entry) =>
                this.object(join(path, entry.name), childAddress(address, entry.name), entry.name),
              ),
          ),
          this.metrics(path, address),
          this.actions(path, address),
          this.directives(path),
          this.workflow(path),
        ]).pipe(
          map(([children, metrics, actions, directives, workflow]) =>
            rawObject({
              path,
              address,
              folder,
              index,
              children,
              metrics,
              actions,
              directives,
              workflow,
            }),
          ),
        ),
      ),
    );
  }

  private metrics(path: string, address: string): Observable<MapMetric[]> {
    const dir = join(path, METRICS);
    return this.store.list(dir).pipe(
      switchMap((entries) =>
        all(
          entries
            .filter((entry) => entry.isDirectory)
            .map((entry) =>
              this.store.json(join(dir, entry.name, CONFIG)).pipe(
                switchMap((raw) => {
                  const metric = ownMetric(path, address, entry.name, raw);
                  if (!metric) return of(undefined);
                  // Цепочка у каждой метрики своя, поэтому и защита от циклов своя.
                  return this.metricChain(metric.config, metric.address, new Set()).pipe(
                    map((chain): MapMetric => ({
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
      map(defined),
    );
  }

  private actions(path: string, address: string): Observable<MapAction[]> {
    const dir = join(path, ACTIONS);
    return this.store.list(dir).pipe(
      switchMap((entries) =>
        all(
          entries
            .filter((entry) => entry.isDirectory)
            .map((entry) =>
              this.store.json(join(dir, entry.name, CONFIG)).pipe(
                switchMap((raw) => {
                  const action = ownAction(path, address, entry.name, raw);
                  if (!action) return of(undefined);
                  // Экшон переиспользуется так же, как метрика: `extends` на общий (решение 0038).
                  return this.actionChain(action.config, action.address, new Set()).pipe(
                    map((chain): MapAction => ({
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
      map(defined),
    );
  }

  /**
   * A metric may extend another metric — decision 0004. Its address points at a folder with a
   * `config.json`, which need not live under `_metrics`: that is how one shared metric serves
   * many objects. Слой за слоем, пока `extends` не кончится: конфиг мерджится, а файл
   * записывается в цепочку.
   */
  private metricChain(
    config: MetricConfig,
    self: string,
    seen: Set<string>,
  ): Observable<Chain<MetricConfig>> {
    return this.chain(config, self, seen, (raw, configPath) =>
      Check(MetricConfig, raw)
        ? this.metricChain(
            anchorDisplay(raw, configPath),
            config.extends ?? "",
            new Set(seen).add(self),
          ).pipe(
            map((parent) => ({
              config: mergeMetric(parent.config, config),
              layers: parent.layers,
            })),
          )
        : undefined,
    );
  }

  /** Как у метрики: слой за слоем, пока `extends` не кончится. */
  private actionChain(
    config: ActionConfig,
    self: string,
    seen: Set<string>,
  ): Observable<Chain<ActionConfig>> {
    return this.chain(config, self, seen, (raw) =>
      Check(ActionConfig, raw)
        ? this.actionChain(raw, config.extends ?? "", new Set(seen).add(self)).pipe(
            map((parent) => ({
              config: mergeAction(parent.config, config),
              layers: parent.layers,
            })),
          )
        : undefined,
    );
  }

  /**
   * Общий шаг цепочки: куда ведёт `extends`, прочитать там `config.json` и отдать слой. Слой
   * дописывается к тому, что вернул родитель, — родитель мог сам получить конфиг выше.
   */
  private chain<T extends { extends?: string }>(
    config: T,
    self: string,
    seen: Set<string>,
    parent: (raw: unknown, configPath: string) => Observable<Chain<T>> | undefined,
  ): Observable<Chain<T>> {
    const address = config.extends;
    const none = of({ config, layers: [] });
    if (!address || seen.has(self)) return none;

    const parsed = parseAddress(address);
    if (!parsed || parsed.scope !== "map") return none;

    const configPath = join(this.mapPath, ...parsed.path, CONFIG);
    const layer: ConfigLayer = { address, path: configPath, from: "extends" };
    return this.store.json(configPath).pipe(
      switchMap((raw) => {
        const resolved = parent(raw, configPath);
        if (!resolved) return none;
        return resolved.pipe(
          map((chain) => ({ config: chain.config, layers: [layer, ...chain.layers] })),
        );
      }),
    );
  }

  private directives(path: string): Observable<MapFile[]> {
    const dir = join(path, DIRECTIVES);
    return this.store
      .list(dir)
      .pipe(
        switchMap((entries) =>
          all(
            filesOf(dir, entries).map((file) =>
              this.store
                .file(directiveStatePath(path, file.name))
                .pipe(
                  switchMap((state) =>
                    state
                      ? this.store
                          .file(file.path)
                          .pipe(map((text) => directiveStatus(file, state, text)))
                      : of(directiveStatus(file, state, undefined)),
                  ),
                ),
            ),
          ),
        ),
      );
  }

  private workflow(path: string): Observable<MapStage[]> {
    const dir = join(path, WORKFLOW);
    return this.store.list(dir).pipe(
      switchMap((entries) =>
        all(
          entries
            .filter((entry) => !entry.isDirectory && entry.name.endsWith(".md"))
            .map((entry) => {
              const file = join(dir, entry.name);
              return this.store.file(file).pipe(map((text) => stageOf(entry.name, file, text)));
            }),
        ),
      ),
      map(sortStages),
    );
  }
}
