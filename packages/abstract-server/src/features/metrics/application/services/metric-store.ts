import { Observable, Subject } from "rxjs";
import { findMetricOwner, groupMetrics } from "@mapward/core";
import type { MapMetric, MapObject, RunSource } from "@mapward/core";
import type { ClockPort, FileWatcher, TimersPort } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { createCancellation, type Cancellation } from "../../../../lib/cancellation.ts";
import { debounce } from "../../../../lib/debounce.ts";
import { createLimit } from "../../../../lib/limit.ts";
import { touches, watchPlan, type Stage, type WatchTarget } from "../../domain/step-watch.ts";
import type { MetricHistory, MetricsDisplaySchema, MetricsMapSource } from "../../ports.ts";
import type { CollectMetric, StepRunner } from "../use-cases/collect-metric.ts";
import type { TransformMetric } from "../use-cases/transform-metric.ts";
import type { Builtins } from "./builtins.ts";
import type { Collected, MetricCache } from "./metric-cache.ts";

/** Что видно про метрику снаружи: значение, когда его собрали, чем кончилось и идёт ли прогон. */
export type MetricValue = {
  updatedAt?: string;
  ok?: boolean;
  data?: unknown;
  busy?: boolean;
  /**
   * Собиралась ли метрика хоть раз. Без этого поля несобранная метрика и метрика, собравшая
   * пустоту, выглядят одинаково: `{ busy: false }` — и то и другое читается как ответ. Поле
   * говорит, ответ это или его отсутствие; когда собиралась, написано в `updatedAt`.
   */
  collected: boolean;
  /**
   * Собранное ещё поднимается с диска: ответа пока нет, и «не собиралась» было бы враньём
   * (решение 0041). Подписка отдаёт метрику сразу с этой пометкой, а следующий снимок уходит,
   * как только поднялась она, — не дожидаясь всей вкладки.
   */
  loading?: boolean;
  /**
   * Данные не прошли схему компонента — решение 0037: строка на поле, путь и что ожидалось.
   * Метрика тогда красная, а компонент не рисуется: ему пришло не то, что он объявил.
   */
  invalid?: string[];
};

export type MetricsSnapshot = Record<string, MetricValue>;

/**
 * Сколько стадии вправе идти — решение 0016. Переданное здесь перебивает то, что стоит на
 * метрике: у зовущего свой предел терпения, и он про него знает больше, чем автор метрики.
 */
export type RunOptions = {
  collectorsTimeout?: number;
  transformsTimeout?: number;
  /** Откуда прогон — для экрана прогонов (решение 0038). Без него: кнопка или сам стор. */
  source?: RunSource;
};

/**
 * `on-display` досчитывает дешёвое и дожидается его — то же, что делает открытие объекта у
 * человека. `none` отдаёт только кэш и ничего не запускает.
 */
export type ReadOptions = RunOptions & { refresh?: "none" | "on-display" };

export type MetricSettings = {
  metricsConcurrency?: number;
  collectorsStaleTime?: number;
  transformsStaleTime?: number;
  /** Мс тишины для вотчера шага без своего `debounce` — решение 0043. */
  watchDebounce?: number;
};

/** Дебаунс вотчера шага, когда его не задали ни шаг, ни карта. */
const WATCH_DEBOUNCE_MS = 300;

/**
 * Что форсить в прогоне — решения 0023 и 0043.
 *
 * `false` — как раньше, по свежести; `"all"` — весь пайплайн, это кнопка обновления;
 * `"transform"` — только стадия трансформа на уже собранных данных: так будит метрику вотчер
 * встроенного шага, которому коллекторы перезапускать незачем. `{ watch }` — вотчер шага:
 * коллектора — только этот коллектор и трансформы за ним, трансформа — только трансформы.
 */
type Force =
  | false
  | "all"
  | "transform"
  | { watch: "collect"; index: number }
  | { watch: "transform" };

/**
 * Идущий прогон изнутри — решение 0043: что в нём вотчер вправе снять и начать заново, не
 * заводя второго прогона.
 */
type LiveRun = {
  stage?: Stage;
  /** Идущие коллекторы: снять и начать заново — по номеру. */
  steps: Map<number, () => void>;
  /** Кого собрать заново, когда кончится текущая стадия. */
  again: Set<number>;
  /** Трансформы протухли, пока шли. */
  transformAgain: boolean;
  stopTransform?: () => void;
};

type Entry = {
  /** Результат стадии сбора — от него считается свежесть коллекторов. */
  collected?: Collected;
  /** Итог пайплайна: то, что видит дисплей. */
  result?: Collected;
  busy: boolean;
  /** Кэш с диска поднимается один раз; пока он идёт, второй подписчик ждёт того же. */
  hydrating?: Promise<void>;
  hydrated: boolean;
  /** Что не прошло схему компонента; считается, когда меняется `result`. */
  invalid?: string[];
  running?: Promise<void>;
  cancel?: () => void;
  live?: LiveRun;
};

const noop = () => {};

const valueOf = (entry: Entry): MetricValue => ({
  updatedAt: entry.result?.updatedAt,
  ok: entry.invalid === undefined ? entry.result?.ok : false,
  data: entry.result?.data,
  busy: entry.busy,
  collected: entry.result !== undefined,
  ...(entry.hydrated ? {} : { loading: true }),
  ...(entry.invalid === undefined ? {} : { invalid: entry.invalid }),
});

/** Отменяется только то, что об этом просили: `cancelOnLeave` у коллектора или трансформа. */
const cancellable = (metric: MapMetric): boolean =>
  [...(metric.config.collectors ?? []), ...(metric.config.transforms ?? [])].some(
    (spec) => spec.cancelOnLeave === true,
  );

/**
 * Стор метрик — решение 0013.
 *
 * Значения живут у сервера, а не у вида: подписчиков может быть несколько (сайдбар, таб,
 * агент через MCP), и считать одно и то же по разу на каждого незачем. Отсюда же и кэш:
 * значение переживает переход по карте, а прогон переживает уход с объекта.
 */
export class MetricStore {
  private readonly maps = new Map<string, Map<string, Entry>>();
  private readonly changes = new Subject<string>();
  private readonly limited: <T>(run: () => Promise<T>) => Promise<T>;

  constructor(
    private readonly map: MetricsMapSource,
    private readonly cache: MetricCache,
    private readonly collector: CollectMetric,
    private readonly transformer: TransformMetric,
    /**
     * Встроенные шаги живут у стора: у них своё состояние, и на каждый прогон заводить его
     * заново значило бы гонять git по разу на метрику — решение 0023.
     */
    private readonly builtins: Builtins,
    private readonly schema: MetricsDisplaySchema,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
    /** Вотчеры шагов следят за файлами проекта напрямую, а не через модель карты (0043). */
    private readonly watcher: FileWatcher,
    private readonly settings: MetricSettings = {},
    private readonly history?: MetricHistory,
  ) {
    // По умолчанию лимита нет: метрик немного, и ждать друг друга им незачем.
    this.limited = createLimit(settings.metricsConcurrency);
  }

  /**
   * Подписка — это и есть «объект открыт». Пока на него смотрят, тикают интервалы; отписался
   * последний — таймеры гаснут, а прогоны с `cancelOnLeave` прерываются.
   *
   * С группами открыт не объект, а вкладка — решение 0025: метрики отбираются до сбора, поэтому
   * у закрытой вкладки не тикают интервалы и не живут вотчеры встроенных шагов. Переключение
   * вкладки — это отписка и подписка, то есть то же самое, что уход на соседний объект.
   *
   * Первый снимок уходит сразу, как известен список метрик: карта у сервера в памяти, а что
   * сервер уже держит, он отдаёт без ожидания. Не поднятое с диска приходит пометкой «ещё
   * поднимается» и догоняет своим снимком — решение 0041.
   */
  watch(
    ref: MapRef,
    address: string | undefined,
    view: { group?: string; metrics?: string[] } = {},
  ): Observable<MetricsSnapshot> {
    return new Observable<MetricsSnapshot>((subscriber) => {
      let metrics: MapMetric[] = [];
      let alive = true;
      const timers: (() => void)[] = [];
      /**
       * Вотчеры шагов по отпечатку — решение 0043. Конфиг метрики живой: правка `watch` в
       * `config.json` меняет, за чем следить, и вотчер переставляется, не дожидаясь, пока объект
       * откроют заново.
       */
      const armed = new Map<string, () => void>();
      /** Метрика и её объект, как они сейчас в карте: вотчер будит свежий конфиг, а не снимок. */
      const latest = new Map<string, { metric: MapMetric; owner: MapObject }>();
      const followed = new Set<string>();

      const push = () => subscriber.next(this.snapshot(ref.mapPath, metrics));

      const subscription = this.changes.subscribe((changed) => {
        if (changed === ref.mapPath && alive) push();
      });

      const arm = (metricAddress: string) => {
        const current = latest.get(metricAddress);
        if (!alive || !current || !followed.has(metricAddress)) return;
        const wanted = this.watchersOf(ref, current, () => latest.get(metricAddress));
        const prefix = `${metricAddress}|`;
        for (const [key, stop] of armed) {
          if (!key.startsWith(prefix) || wanted.has(key)) continue;
          stop();
          armed.delete(key);
        }
        for (const [key, make] of wanted) if (!armed.has(key)) armed.set(key, make());
      };

      const pick = (map: MapObject): MapObject =>
        (address ? findMetricOwnerObject(map, address) : map) ?? map;

      void (async () => {
        const map = await this.map.current(ref);
        const object = pick(map);
        // Названные ключи бьют группу: так подписывается таб одной метрики — он открыт ради
        // неё, и поднимать вместе с ней всю вкладку незачем (решение 0026).
        const shown = groupMetrics(object, view.group);
        metrics =
          view.metrics === undefined
            ? shown
            : object.metrics.filter((metric) => view.metrics?.includes(metric.key));
        if (!alive) return;
        for (const metric of metrics) latest.set(metric.address, { metric, owner: object });

        push();

        // Живая карта: поменялся конфиг метрики — вотчеры её шагов переставляются.
        const updates = this.map.watch?.(ref).subscribe((next) => {
          const owner = pick(next);
          for (const metric of owner.metrics) {
            const known = latest.get(metric.address);
            if (!known || known.metric === metric) continue;
            latest.set(metric.address, { metric, owner });
            arm(metric.address);
          }
        });
        if (updates) timers.push(() => updates.unsubscribe());

        for (const metric of metrics) {
          void this.hydrate(ref.mapPath, metric).then(() => {
            if (!alive) return;
            push();
            followed.add(metric.address);
            arm(metric.address);
            this.follow(ref, metric, object, timers);
          });
        }
      })();

      return () => {
        alive = false;
        subscription.unsubscribe();
        for (const stop of timers) stop();
        for (const stop of armed.values()) stop();
        armed.clear();
        for (const metric of metrics) {
          if (!cancellable(metric)) continue;
          this.entryOf(ref.mapPath, metric.address).cancel?.();
        }
      };
    });
  }

  /**
   * Значения без прогона: агенту через MCP нужно то же, что видит человек на экране, а не
   * повод запустить дорогую метрику (решение 0009).
   *
   * С `refresh: "on-display"` дешёвое досчитывается — решение 0016. Это тот же проход, что
   * делает открытие объекта у человека; разница в том, что подписка прогона не ждёт, а
   * чтение ждёт: агенту ответ уходит целиком, дорисовывать ему нечего.
   */
  async read(ref: MapRef, object: MapObject, options: ReadOptions = {}): Promise<MetricsSnapshot> {
    await Promise.all(object.metrics.map((metric) => this.hydrate(ref.mapPath, metric)));

    if (options.refresh === "on-display") {
      await Promise.all(
        object.metrics
          .filter((metric) => (metric.config.refresh ?? "manual") !== "manual")
          .map((metric) =>
            this.waitAtMost(this.start(ref, metric, object, false, options), options),
          ),
      );
    }

    return this.snapshot(ref.mapPath, object.metrics);
  }

  /**
   * Ручной прогон: кнопка свежесть не спрашивает, пайплайн идёт целиком.
   *
   * С `wait: false` вызов возвращает управление сразу, отдав `busy: true`. Прогон от этого
   * не прерывается — он живёт у стора, а не у вызова, — и досматривается обычным чтением.
   * Иначе дорогая метрика запускается вызовом, который обязан упасть по таймауту.
   */
  async run(
    ref: MapRef,
    metricAddress: string,
    options: RunOptions & { wait?: boolean } = {},
  ): Promise<MetricValue> {
    const map = await this.map.current(ref);
    const found = findMetricOwner(map, metricAddress);
    if (!found) throw new Error(`Метрика ${metricAddress} не найдена`);
    await this.hydrate(ref.mapPath, found.metric);
    const running = this.start(ref, found.metric, found.object, "all", options);
    if (options.wait !== false) await this.waitAtMost(running, options);
    return valueOf(this.entryOf(ref.mapPath, metricAddress));
  }

  /**
   * Вотчеры шагов одной метрики по отпечатку: что поставить, если такого ещё нет. Живут, пока
   * объект открыт, — как интервал, и гаснут там же. Ставятся и у `manual`: написанный `watch` —
   * это и есть согласие на запуск (решение 0043), а пометка встроенного шага идёт от `.git` сама
   * (решение 0023).
   */
  private watchersOf(
    ref: MapRef,
    current: { metric: MapMetric; owner: MapObject },
    now: () => { metric: MapMetric; owner: MapObject } | undefined,
  ): Map<string, () => () => void> {
    const { metric, owner } = current;
    const wanted = new Map<string, () => () => void>();

    for (const [index, spec] of (metric.config.transforms ?? []).entries()) {
      const step = this.builtins.step(String(spec.kind ?? ""));
      if (!step) continue;
      wanted.set(`${metric.address}|builtin|${index}|${String(spec.kind)}`, () => {
        const data = this.entryOf(ref.mapPath, metric.address).result?.data;
        return step.watch(data, owner.path, () => {
          const fresh = now();
          if (fresh) void this.start(ref, fresh.metric, fresh.owner, "transform");
        });
      });
    }

    for (const target of watchPlan(metric.config, ref.mapPath).targets) {
      wanted.set(`${metric.address}|${target.key}`, () =>
        this.watchStep(target, () => {
          const fresh = now();
          if (fresh) this.poke(ref, fresh.metric, fresh.owner, target);
        }),
      );
    }

    return wanted;
  }

  /** Вотчер одного шага: порт следит за папками, изменение сверяется с глобами шага. */
  private watchStep(target: WatchTarget, fire: () => void): () => void {
    const ms = target.debounce ?? this.settings.watchDebounce ?? WATCH_DEBOUNCE_MS;
    // Дебаунс раньше отмены: пока файлы сохраняются подряд, идущий шаг не трогается.
    const beat = debounce(this.timers, this.clock, ms, fire);
    const stops = target.roots.map(({ root, pattern }) =>
      this.watcher.watch(
        root,
        (path) => {
          if (touches(target, path)) beat.tick();
        },
        { include: [pattern] },
      ),
    );
    return () => {
      beat.cancel();
      for (const stop of stops) stop();
    };
  }

  /**
   * Сработал вотчер шага — решение 0043. Идёт прогон — перезапускается своя часть внутри него:
   * второй прогон не заводится и конца идущего никто не ждёт. Не идёт — начинается прогон
   * ровно этой части.
   */
  private poke(ref: MapRef, metric: MapMetric, owner: MapObject, target: WatchTarget): void {
    const entry = this.entryOf(ref.mapPath, metric.address);
    const live = entry.live;

    if (live?.stage) {
      if (target.stage === "collect") {
        const restart = live.steps.get(target.index);
        if (restart && live.stage === "collect") {
          restart();
          return;
        }
        // Уже собран или ещё в очереди — соберётся заново, как кончится стадия; трансформы на
        // протухших данных снимаются сразу.
        live.again.add(target.index);
        if (live.stage === "transform") live.stopTransform?.();
        return;
      }
      // Во время сбора трансформы и так пойдут следом, на свежем.
      if (live.stage === "transform") {
        live.transformAgain = true;
        live.stopTransform?.();
      }
      return;
    }

    // Прогон заведён, но ни одной стадии ещё не начал: он может и вовсе выйти по свежести.
    // Тогда своя часть идёт следом за ним.
    if (entry.running) {
      void entry.running.then(() => this.poke(ref, metric, owner, target));
      return;
    }

    const force: Force =
      target.stage === "collect"
        ? { watch: "collect", index: target.index }
        : { watch: "transform" };
    void this.start(ref, metric, owner, force, { source: "watch" });
  }

  /** Досчёт и интервал одной метрики — пока объект открыт. */
  private follow(ref: MapRef, metric: MapMetric, object: MapObject, timers: (() => void)[]) {
    const refresh = metric.config.refresh ?? "manual";
    if (refresh === "manual") return;

    // Значение уже показано; прогон идёт следом и меняет его — решение 0013.
    void this.start(ref, metric, object, false);

    const interval = /^interval:(\d+)$/.exec(refresh)?.[1];
    if (!interval) return;
    // Интервал тикает, пока объект открыт хотя бы в одном виде.
    timers.push(
      this.timers.every(
        Number(interval),
        () => void this.start(ref, metric, object, "all", { source: "refresh" }),
      ),
    );
  }

  private entriesOf(mapPath: string): Map<string, Entry> {
    const existing = this.maps.get(mapPath);
    if (existing) return existing;
    const created = new Map<string, Entry>();
    this.maps.set(mapPath, created);
    return created;
  }

  private entryOf(mapPath: string, address: string): Entry {
    const all = this.entriesOf(mapPath);
    const existing = all.get(address);
    if (existing) return existing;
    const created: Entry = { busy: false, hydrated: false };
    all.set(address, created);
    return created;
  }

  /** Схему компонента проверяет сервер, а не клиент: валидатор есть только здесь (0037). */
  private async validate(metric: MapMetric, entry: Entry): Promise<void> {
    if (!entry.result) return;
    const errors = await this.schema.check(metric.config.display, entry.result.data);
    entry.invalid = errors.length > 0 ? errors : undefined;
  }

  /** Первое значение поднимается из файлов: собранное раньше показывается до прогона. */
  private hydrate(mapPath: string, metric: MapMetric): Promise<void> {
    const entry = this.entryOf(mapPath, metric.address);
    if (entry.hydrating) return entry.hydrating;

    entry.hydrating = (async () => {
      const [collected, transformed] = await Promise.all([
        this.cache.read(metric, "collect.json"),
        this.cache.read(metric, "transform.json"),
      ]);
      // Пока поднимали, метрику могли собрать заново: свежее с диска не затирается.
      if (collected && !entry.collected) entry.collected = collected;
      // Приоритет из решения 0004: память, потом transform, потом collect.
      const result = transformed ?? collected;
      if (result && !entry.result) {
        entry.result = result;
        await this.validate(metric, entry);
      }
    })().finally(() => {
      entry.hydrated = true;
      this.changes.next(mapPath);
    });
    return entry.hydrating;
  }

  /** Без `staleTime` метрика ведёт себя как раньше: каждое открытие — новый прогон. */
  private stale(at: string | undefined, staleTime: number | undefined): boolean {
    if (at === undefined) return true;
    if (staleTime === undefined) return true;
    const age = Date.parse(this.clock.now()) - Date.parse(at);
    return Number.isNaN(age) || age > staleTime;
  }

  private async runOnce(
    ref: MapRef,
    metric: MapMetric,
    owner: MapObject,
    force: Force,
    options: RunOptions = {},
  ): Promise<void> {
    const entry = this.entryOf(ref.mapPath, metric.address);
    const config = metric.config;

    // Своё у метрики перебивает общее: настройка карты — умолчание, а не замена (решение 0016).
    const collectorsStaleTime = config.collectorsStaleTime ?? this.settings.collectorsStaleTime;
    const transformsStaleTime = config.transformsStaleTime ?? this.settings.transformsStaleTime;

    // Тик вотчера гонит один трансформ: сбор за ним не идёт даже протухшим. Иначе правка в `.git`
    // поднимала бы агента у метрики, которая собирается промптом, — решение 0023.
    // Вотчер трансформа — то же самое: сбор не его дело (решение 0043).
    const watched = typeof force === "object" ? force : undefined;
    if ((force === "transform" || watched?.watch === "transform") && !entry.collected) return;

    const needCollect =
      force === "all" ||
      watched?.watch === "collect" ||
      (force === false && this.stale(entry.collected?.updatedAt, collectorsStaleTime));
    const hasTransforms = (config.transforms ?? []).length > 0;
    // Шагу со своим состоянием свежесть не считается: его ответ протухает от `.git`, а не от
    // часов, и `transformsStaleTime` удержал бы на экране пометку вчерашнего дня — решение 0023.
    const needTransform =
      hasTransforms &&
      (force !== false ||
        needCollect ||
        this.builtins.stateful(config) ||
        this.stale(entry.result?.updatedAt, transformsStaleTime));

    if (!needCollect && !needTransform) return;

    const { token, cancel } = createCancellation();
    entry.cancel = cancel;
    entry.busy = true;
    this.changes.next(ref.mapPath);

    // Кнопка — это «all»; открытие объекта и тики — сам стор. Зовущий может сказать точнее.
    // Пометку git, которую будит `.git`, прогоном не пишем: иначе каждая правка файла в
    // репозитории вытесняла бы из истории настоящие прогоны.
    const record =
      force === "transform"
        ? undefined
        : this.history?.recordMetric(
            ref.mapPath,
            {
              target: metric.address,
              object: owner.address,
              label: config.label ?? metric.key,
              source: options.source ?? (force === "all" ? "ui" : watched ? "watch" : "refresh"),
              config,
            },
            cancel,
          );
    let stageLog: string | undefined;
    let stageOutput: unknown;
    const report = (log: string, output?: unknown) => {
      stageLog = log || undefined;
      stageOutput = output;
    };
    // Вывод идущей стадии — сразу в её шаг: лог растёт на экране прогонов, не дожидаясь конца.
    const output =
      record && ((chunk: string, stream: "out" | "err") => record.output(chunk, stream));

    // Истёкшее время отменяет прогон теми же средствами, что кнопка, но неудачей считается
    // только оно: отмене нечего записать, а здесь ответ обещали и не дали — решение 0016.
    //
    // Срок стадии считается от её первого начала: перезапуски вотчером его не продлевают, иначе
    // частые сохранения тянули бы его без конца (решение 0043).
    let expired: { stage: Stage; ms: number } | undefined;
    const began: Partial<Record<Stage, number>> = {};
    const deadline = (stage: Stage, ms: number | undefined): (() => void) => {
      if (ms === undefined) return noop;
      const now = Date.parse(this.clock.now());
      const start = (began[stage] ??= now);
      return this.timers.after(Math.max(0, ms - (now - start)), () => {
        expired = { stage, ms };
        cancel();
      });
    };

    let stopDeadline = noop;

    const live: LiveRun = { steps: new Map(), again: new Set(), transformAgain: false };
    entry.live = live;
    const step = this.restartable(live, token);
    const problems = watchPlan(config, ref.mapPath).problems;

    try {
      let only = watched?.watch === "collect" ? [watched.index] : undefined;
      // Свежий сбор с протухшим трансформом — прогон одного трансформа на готовых данных.
      let collect = needCollect || !entry.collected;

      for (;;) {
        if (collect) {
          const plan = { ...(only ? { only } : {}), step, problems, output };
          // oxlint-disable-next-line no-await-in-loop
          const collected = await this.limited(() => {
            live.stage = "collect";
            stopDeadline = deadline(
              "collect",
              options.collectorsTimeout ?? config.collectorsTimeout,
            );
            record?.step("сбор");
            stageLog = undefined;
            stageOutput = undefined;
            return this.collector
              .run(metric, owner, ref.mapPath, token, entry.collected, report, plan)
              .finally(stopDeadline);
          });
          entry.collected = collected;
          record?.stepDone(collected.ok ? "success" : "failure", stageLog, stageOutput);
        }
        const collected = entry.collected;
        if (!collected) break;

        // Уже собранный коллектор протух, пока шли соседи, — заново он, до трансформов.
        if (live.again.size > 0) {
          only = [...live.again];
          live.again.clear();
          collect = true;
          continue;
        }

        if (!hasTransforms) {
          entry.result = collected;
          break;
        }

        // Своя отмена у стадии: вотчер снимает трансформы, не трогая прогона целиком.
        live.transformAgain = false;
        const stage = createCancellation();
        token.onCancel(stage.cancel);
        live.stopTransform = stage.cancel;
        let result: Collected | undefined;
        try {
          // oxlint-disable-next-line no-await-in-loop
          result = await this.limited(() => {
            live.stage = "transform";
            stopDeadline = deadline(
              "transform",
              options.transformsTimeout ?? config.transformsTimeout,
            );
            record?.step("трансформ");
            stageLog = undefined;
            stageOutput = undefined;
            return this.transformer
              .run(metric, owner, ref.mapPath, collected, stage.token, entry.result, report, output)
              .finally(stopDeadline);
          });
        } catch (error) {
          if (token.cancelled || !stage.token.cancelled) throw error;
        } finally {
          live.stopTransform = undefined;
        }

        // Снятое вотчером — не неудача: шаг помечается остановленным, и стадия идёт заново.
        if (stage.token.cancelled || live.transformAgain || live.again.size > 0 || !result) {
          record?.stepDone("stopped", "снят вотчером: данные устарели, идёт заново");
          collect = live.again.size > 0;
          only = collect ? [...live.again] : undefined;
          live.again.clear();
          continue;
        }

        entry.result = result;
        record?.stepDone(result.ok ? "success" : "failure", stageLog, stageOutput);
        break;
      }
      record?.end(entry.result?.ok === false ? "failure" : "success");
    } catch (error) {
      // Отмена — не неудача: значение остаётся прежним, писать нечего. Таймаут — неудача.
      if (expired) {
        record?.stepDone("failure", `время вышло, предел ${expired.ms} мс`);
        record?.end("failure", `время вышло, предел ${expired.ms} мс`);
        // Снятый по времени прогон до своего лога не доходит: он падает отменой, минуя запись.
        // Поэтому причину пишем здесь — иначе красная точка ведёт в лог прошлого прогона или
        // в пустоту, а «время вышло» не написано нигде.
        await this.cache.writeLogs(
          metric,
          expired.stage === "collect" ? "collect.logs.json" : "transform.logs.json",
          `${expired.stage === "collect" ? "Сбор" : "Трансформ"} снят: время вышло, ` +
            `предел ${expired.ms} мс.`,
        );
        entry.result = {
          updatedAt: this.clock.now(),
          ok: false,
          data: entry.result?.data,
        };
      } else if (token.cancelled) {
        record?.stepDone("stopped");
        record?.end("stopped");
      } else {
        record?.stepDone("failure", String(error));
        record?.end("failure", String(error));
        entry.result = {
          updatedAt: this.clock.now(),
          ok: false,
          data: entry.result?.data ?? { text: String(error) },
        };
      }
    } finally {
      stopDeadline();
      live.stage = undefined;
      if (entry.live === live) entry.live = undefined;
      await this.validate(metric, entry);
      entry.busy = false;
      entry.cancel = undefined;
      this.changes.next(ref.mapPath);
    }
  }

  /**
   * Коллектор, которого вотчер вправе снять и начать заново, — решение 0043. У каждого своя
   * отмена, вложенная в общую: кнопка «стоп» и уход с объекта снимают всё, вотчер — только свой.
   * Попытка, которую вотчер задел, не в счёт, даже если успела дойти: её данные уже протухли.
   */
  private restartable(live: LiveRun, token: Cancellation): StepRunner {
    return async <T>(index: number, attempt: (cancel?: Cancellation) => Promise<T>) => {
      for (;;) {
        const own = createCancellation();
        token.onCancel(own.cancel);
        let restarted = false;
        live.steps.set(index, () => {
          restarted = true;
          own.cancel();
        });
        try {
          // oxlint-disable-next-line no-await-in-loop
          const value = await attempt(own.token);
          if (!restarted || token.cancelled) return value;
        } catch (error) {
          if (!restarted || token.cancelled) throw error;
        } finally {
          live.steps.delete(index);
        }
      }
    };
  }

  /**
   * Один прогон на метрику: второй подписчик присоединяется к идущему, а не заводит свой.
   *
   * Отметку о прогоне снимает тот, кто её поставил, и снимает всегда: `runOnce` выходит и до
   * своего `finally` — например когда значение свежее и делать нечего. Снимай её там, отметка
   * пережила бы такой выход и залипла навсегда: `start` отдавал бы давно разрешённый промис,
   * и ни кнопка обновления, ни тик интервала больше ничего бы не запускали.
   */
  private start(
    ref: MapRef,
    metric: MapMetric,
    owner: MapObject,
    force: Force,
    options: RunOptions = {},
  ): Promise<void> {
    const entry = this.entryOf(ref.mapPath, metric.address);
    if (entry.running) return entry.running;
    const running: Promise<void> = this.runOnce(ref, metric, owner, force, options).finally(() => {
      if (entry.running === running) entry.running = undefined;
    });
    entry.running = running;
    return running;
  }

  private snapshot(mapPath: string, metrics: MapMetric[]): MetricsSnapshot {
    return Object.fromEntries(
      metrics.map((metric) => [metric.address, valueOf(this.entryOf(mapPath, metric.address))]),
    );
  }

  /**
   * Присоединиться к идущему прогону можно, а навязать ему свой срок — нет: он начат не этим
   * вызовом. Поэтому вызов перестаёт ждать сам, чужого прогона не трогая, и в ответ уходит
   * то, что уже есть, вместе с `busy`.
   */
  private waitAtMost(running: Promise<void>, options: RunOptions): Promise<void> {
    const ms = options.collectorsTimeout ?? options.transformsTimeout;
    if (ms === undefined) return running;

    return new Promise((resolve) => {
      const stop = this.timers.after(ms, resolve);
      void running.finally(() => {
        stop();
        resolve();
      });
    });
  }
}

/** Объект по адресу, включая корень: у адреса метрики владелец ищется по самой метрике. */
function findMetricOwnerObject(map: MapObject, address: string): MapObject | undefined {
  if (map.address === address) return map;
  for (const child of map.children) {
    const found = findMetricOwnerObject(child, address);
    if (found) return found;
  }
  return undefined;
}
