import { Observable, Subject } from "rxjs";
import { findMetricOwner, groupMetrics } from "@mapward/core";
import type { MapMetric, MapObject, RunSource } from "@mapward/core";
import type { ClockPort, TimersPort } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { createCancellation } from "../../../../lib/cancellation.ts";
import { createLimit } from "../../../../lib/limit.ts";
import type { MetricHistory, MetricsDisplaySchema, MetricsMapSource } from "../../ports.ts";
import type { CollectMetric } from "../use-cases/collect-metric.ts";
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
};

/**
 * Что форсить в прогоне — решение 0023.
 *
 * `false` — как раньше, по свежести; `"all"` — весь пайплайн, это кнопка обновления;
 * `"transform"` — только стадия трансформа на уже собранных данных: так будит метрику вотчер
 * встроенного шага, которому коллекторы перезапускать незачем.
 */
type Force = false | "all" | "transform";

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

      const push = () => subscriber.next(this.snapshot(ref.mapPath, metrics));

      const subscription = this.changes.subscribe((changed) => {
        if (changed === ref.mapPath && alive) push();
      });

      void (async () => {
        const map = await this.map.current(ref);
        const object = (address ? findMetricOwnerObject(map, address) : map) ?? map;
        // Названные ключи бьют группу: так подписывается таб одной метрики — он открыт ради
        // неё, и поднимать вместе с ней всю вкладку незачем (решение 0026).
        const shown = groupMetrics(object, view.group);
        metrics =
          view.metrics === undefined
            ? shown
            : object.metrics.filter((metric) => view.metrics?.includes(metric.key));
        if (!alive) return;

        push();

        for (const metric of metrics) {
          void this.hydrate(ref.mapPath, metric).then(() => {
            if (!alive) return;
            push();
            this.follow(ref, metric, object, timers);
          });
        }
      })();

      return () => {
        alive = false;
        subscription.unsubscribe();
        for (const stop of timers) stop();
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

  /** Вотчеры встроенных шагов, досчёт и интервал одной метрики — пока объект открыт. */
  private follow(ref: MapRef, metric: MapMetric, object: MapObject, timers: (() => void)[]) {
    // Вотчер встроенного шага живёт, пока объект открыт, — как интервал, и гаснет там же.
    // Ставится и у `manual`: кнопки ждёт сбор, а пометка про файл идёт от `.git` сама
    // (решение 0023).
    for (const step of this.builtins.stepsOf(metric.config)) {
      const data = this.entryOf(ref.mapPath, metric.address).result?.data;
      timers.push(
        step.watch(data, object.path, () => void this.start(ref, metric, object, "transform")),
      );
    }

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
    if (force === "transform" && !entry.collected) return;

    const needCollect =
      force === "all" ||
      (force !== "transform" && this.stale(entry.collected?.updatedAt, collectorsStaleTime));
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
              source: options.source ?? (force === "all" ? "ui" : "refresh"),
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

    // Истёкшее время отменяет прогон теми же средствами, что кнопка, но неудачей считается
    // только оно: отмене нечего записать, а здесь ответ обещали и не дали — решение 0016.
    let expired: { stage: "collect" | "transform"; ms: number } | undefined;
    const deadline = (stage: "collect" | "transform", ms: number | undefined): (() => void) =>
      ms === undefined
        ? noop
        : this.timers.after(ms, () => {
            expired = { stage, ms };
            cancel();
          });

    let stopDeadline = noop;

    try {
      // Свежий сбор с протухшим трансформом — прогон одного трансформа на готовых данных.
      const collected =
        needCollect || !entry.collected
          ? await this.limited(() => {
              stopDeadline = deadline(
                "collect",
                options.collectorsTimeout ?? config.collectorsTimeout,
              );
              record?.step("сбор");
              stageLog = undefined;
              stageOutput = undefined;
              return this.collector
                .run(metric, owner, ref.mapPath, token, entry.collected, report)
                .finally(stopDeadline);
            })
          : entry.collected;
      entry.collected = collected;
      record?.stepDone(collected.ok ? "success" : "failure", stageLog, stageOutput);

      entry.result = hasTransforms
        ? await this.limited(() => {
            stopDeadline = deadline(
              "transform",
              options.transformsTimeout ?? config.transformsTimeout,
            );
            record?.step("трансформ");
            stageLog = undefined;
            stageOutput = undefined;
            return this.transformer
              .run(metric, owner, ref.mapPath, collected, token, entry.result, report)
              .finally(stopDeadline);
          })
        : collected;
      if (hasTransforms) {
        record?.stepDone(entry.result.ok ? "success" : "failure", stageLog, stageOutput);
      }
      record?.end(entry.result.ok ? "success" : "failure");
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
      await this.validate(metric, entry);
      entry.busy = false;
      entry.cancel = undefined;
      this.changes.next(ref.mapPath);
    }
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
