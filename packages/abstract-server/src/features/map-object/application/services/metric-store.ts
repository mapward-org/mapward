import { Observable, Subject } from "rxjs";
import { findMetricOwner } from "@mapward/core";
import type { MapMetric, MapObject } from "@mapward/core";
import type { ServerPorts } from "../../../../ports/index.ts";
import { createCancellation } from "../../../../lib/cancellation.ts";
import { createLimit } from "../../../../lib/limit.ts";
import { collect, readCache, writeLogs, type Collected } from "../use-cases/collect.ts";
import { transform } from "../use-cases/transform.ts";
import { createBuiltins } from "./builtin.ts";

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
};

export type MetricsSnapshot = Record<string, MetricValue>;

/**
 * Сколько стадии вправе идти — решение 0016. Переданное здесь перебивает то, что стоит на
 * метрике: у зовущего свой предел терпения, и он про него знает больше, чем автор метрики.
 */
export type RunOptions = { collectorsTimeout?: number; transformsTimeout?: number };

/**
 * `on-display` досчитывает дешёвое и дожидается его — то же, что делает открытие объекта у
 * человека. `none` отдаёт только кэш и ничего не запускает.
 */
export type ReadOptions = RunOptions & { refresh?: "none" | "on-display" };

export type MapRef = { mapPath: string; basePath: string; name: string };

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
  hydrated: boolean;
  running?: Promise<void>;
  cancel?: () => void;
};

const noop = () => {};

const valueOf = (entry: Entry): MetricValue => ({
  updatedAt: entry.result?.updatedAt,
  ok: entry.result?.ok,
  data: entry.result?.data,
  busy: entry.busy,
  collected: entry.result !== undefined,
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
export function createMetricStore(
  ports: ServerPorts,
  readMap: (ref: MapRef) => Promise<MapObject>,
  settings: {
    metricsConcurrency?: number;
    collectorsStaleTime?: number;
    transformsStaleTime?: number;
  } = {},
) {
  const maps = new Map<string, Map<string, Entry>>();
  const changes = new Subject<string>();
  // По умолчанию лимита нет: метрик немного, и ждать друг друга им незачем.
  const limited = createLimit(settings.metricsConcurrency);
  // Встроенные шаги живут у стора: у них своё состояние, и на каждый прогон заводить его заново
  // значило бы гонять git по разу на метрику — решение 0023.
  const builtins = createBuiltins(ports);

  const entriesOf = (mapPath: string) => {
    const existing = maps.get(mapPath);
    if (existing) return existing;
    const created = new Map<string, Entry>();
    maps.set(mapPath, created);
    return created;
  };

  const entryOf = (mapPath: string, address: string): Entry => {
    const all = entriesOf(mapPath);
    const existing = all.get(address);
    if (existing) return existing;
    const created: Entry = { busy: false, hydrated: false };
    all.set(address, created);
    return created;
  };

  /** Первое значение поднимается из файлов: собранное раньше показывается до прогона. */
  async function hydrate(mapPath: string, metric: MapMetric): Promise<void> {
    const entry = entryOf(mapPath, metric.address);
    if (entry.hydrated) return;
    entry.hydrated = true;

    const collected = await readCache(ports.files, metric, "collect.json");
    const transformed = await readCache(ports.files, metric, "transform.json");
    if (collected) entry.collected = collected;
    // Приоритет из решения 0004: память, потом transform, потом collect.
    const result = transformed ?? collected;
    if (result) {
      entry.result = result;
      changes.next(mapPath);
    }
  }

  /** Без `staleTime` метрика ведёт себя как раньше: каждое открытие — новый прогон. */
  function stale(at: string | undefined, staleTime: number | undefined): boolean {
    if (at === undefined) return true;
    if (staleTime === undefined) return true;
    const age = Date.parse(ports.clock.now()) - Date.parse(at);
    return Number.isNaN(age) || age > staleTime;
  }

  async function runOnce(
    ref: MapRef,
    metric: MapMetric,
    owner: MapObject,
    force: Force,
    options: RunOptions = {},
  ): Promise<void> {
    const entry = entryOf(ref.mapPath, metric.address);
    const config = metric.config;

    // Своё у метрики перебивает общее: настройка карты — умолчание, а не замена (решение 0016).
    const collectorsStaleTime = config.collectorsStaleTime ?? settings.collectorsStaleTime;
    const transformsStaleTime = config.transformsStaleTime ?? settings.transformsStaleTime;

    // Тик вотчера гонит один трансформ: сбор за ним не идёт даже протухшим. Иначе правка в `.git`
    // поднимала бы агента у метрики, которая собирается промптом, — решение 0023.
    if (force === "transform" && !entry.collected) return;

    const needCollect =
      force === "all" ||
      (force !== "transform" && stale(entry.collected?.updatedAt, collectorsStaleTime));
    const hasTransforms = (config.transforms ?? []).length > 0;
    // Шагу со своим состоянием свежесть не считается: его ответ протухает от `.git`, а не от
    // часов, и `transformsStaleTime` удержал бы на экране пометку вчерашнего дня — решение 0023.
    const needTransform =
      hasTransforms &&
      (force !== false ||
        needCollect ||
        builtins.stateful(config) ||
        stale(entry.result?.updatedAt, transformsStaleTime));

    if (!needCollect && !needTransform) return;

    const { token, cancel } = createCancellation();
    entry.cancel = cancel;
    entry.busy = true;
    changes.next(ref.mapPath);

    // Истёкшее время отменяет прогон теми же средствами, что кнопка, но неудачей считается
    // только оно: отмене нечего записать, а здесь ответ обещали и не дали — решение 0016.
    let expired: { stage: "collect" | "transform"; ms: number } | undefined;
    const deadline = (stage: "collect" | "transform", ms: number | undefined): (() => void) =>
      ms === undefined
        ? noop
        : ports.timers.after(ms, () => {
            expired = { stage, ms };
            cancel();
          });

    let stopDeadline = noop;

    try {
      // Свежий сбор с протухшим трансформом — прогон одного трансформа на готовых данных.
      const collected =
        needCollect || !entry.collected
          ? await limited(() => {
              stopDeadline = deadline(
                "collect",
                options.collectorsTimeout ?? config.collectorsTimeout,
              );
              return collect(ports, metric, owner, ref.mapPath, token, entry.collected).finally(
                stopDeadline,
              );
            })
          : entry.collected;
      entry.collected = collected;

      entry.result = hasTransforms
        ? await limited(() => {
            stopDeadline = deadline(
              "transform",
              options.transformsTimeout ?? config.transformsTimeout,
            );
            return transform(
              ports,
              builtins,
              metric,
              owner,
              ref.mapPath,
              collected,
              token,
              entry.result,
            ).finally(stopDeadline);
          })
        : collected;
    } catch (error) {
      // Отмена — не неудача: значение остаётся прежним, писать нечего. Таймаут — неудача.
      if (expired) {
        // Снятый по времени прогон до своего лога не доходит: он падает отменой, минуя запись.
        // Поэтому причину пишем здесь — иначе красная точка ведёт в лог прошлого прогона или
        // в пустоту, а «время вышло» не написано нигде.
        await writeLogs(
          ports.files,
          metric,
          expired.stage === "collect" ? "collect.logs.json" : "transform.logs.json",
          `${expired.stage === "collect" ? "Сбор" : "Трансформ"} снят: время вышло, ` +
            `предел ${expired.ms} мс.`,
        );
        entry.result = {
          updatedAt: ports.clock.now(),
          ok: false,
          data: entry.result?.data,
        };
      } else if (!token.cancelled) {
        entry.result = {
          updatedAt: ports.clock.now(),
          ok: false,
          data: entry.result?.data ?? { text: String(error) },
        };
      }
    } finally {
      stopDeadline();
      entry.busy = false;
      entry.cancel = undefined;
      changes.next(ref.mapPath);
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
  function start(
    ref: MapRef,
    metric: MapMetric,
    owner: MapObject,
    force: Force,
    options: RunOptions = {},
  ): Promise<void> {
    const entry = entryOf(ref.mapPath, metric.address);
    if (entry.running) return entry.running;
    const running: Promise<void> = runOnce(ref, metric, owner, force, options).finally(() => {
      if (entry.running === running) entry.running = undefined;
    });
    entry.running = running;
    return running;
  }

  const snapshot = (mapPath: string, metrics: MapMetric[]): MetricsSnapshot =>
    Object.fromEntries(
      metrics.map((metric) => [metric.address, valueOf(entryOf(mapPath, metric.address))]),
    );

  /**
   * Подписка — это и есть «объект открыт». Пока на него смотрят, тикают интервалы; отписался
   * последний — таймеры гаснут, а прогоны с `cancelOnLeave` прерываются.
   */
  function watch(ref: MapRef, address: string | undefined): Observable<MetricsSnapshot> {
    return new Observable<MetricsSnapshot>((subscriber) => {
      let metrics: MapMetric[] = [];
      let alive = true;
      const timers: (() => void)[] = [];

      const push = () => subscriber.next(snapshot(ref.mapPath, metrics));

      const subscription = changes.subscribe((changed) => {
        if (changed === ref.mapPath && alive) push();
      });

      void (async () => {
        const map = await readMap(ref);
        const object = (address ? findMetricOwnerObject(map, address) : map) ?? map;
        metrics = object.metrics;
        if (!alive) return;

        await Promise.all(metrics.map((metric) => hydrate(ref.mapPath, metric)));
        push();

        for (const metric of metrics) {
          // Вотчер встроенного шага живёт, пока объект открыт, — как интервал, и гаснет там же.
          // Ставится и у `manual`: кнопки ждёт сбор, а пометка про файл идёт от `.git` сама
          // (решение 0023).
          for (const step of builtins.stepsOf(metric.config)) {
            const data = entryOf(ref.mapPath, metric.address).result?.data;
            timers.push(
              step.watch(data, object.path, () => void start(ref, metric, object, "transform")),
            );
          }

          const refresh = metric.config.refresh ?? "manual";
          if (refresh === "manual") continue;

          // Значение уже показано; прогон идёт следом и меняет его — решение 0013.
          void start(ref, metric, object, false);

          const interval = /^interval:(\d+)$/.exec(refresh)?.[1];
          if (!interval) continue;
          // Интервал тикает, пока объект открыт хотя бы в одном виде.
          timers.push(
            ports.timers.every(Number(interval), () => void start(ref, metric, object, "all")),
          );
        }
      })();

      return () => {
        alive = false;
        subscription.unsubscribe();
        for (const stop of timers) stop();
        for (const metric of metrics) {
          if (!cancellable(metric)) continue;
          entryOf(ref.mapPath, metric.address).cancel?.();
        }
      };
    });
  }

  /**
   * Присоединиться к идущему прогону можно, а навязать ему свой срок — нет: он начат не этим
   * вызовом. Поэтому вызов перестаёт ждать сам, чужого прогона не трогая, и в ответ уходит
   * то, что уже есть, вместе с `busy`.
   */
  function waitAtMost(running: Promise<void>, options: RunOptions): Promise<void> {
    const ms = options.collectorsTimeout ?? options.transformsTimeout;
    if (ms === undefined) return running;

    return new Promise((resolve) => {
      const stop = ports.timers.after(ms, resolve);
      void running.finally(() => {
        stop();
        resolve();
      });
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
  async function read(
    ref: MapRef,
    object: MapObject,
    options: ReadOptions = {},
  ): Promise<MetricsSnapshot> {
    await Promise.all(object.metrics.map((metric) => hydrate(ref.mapPath, metric)));

    if (options.refresh === "on-display") {
      await Promise.all(
        object.metrics
          .filter((metric) => (metric.config.refresh ?? "manual") !== "manual")
          .map((metric) => waitAtMost(start(ref, metric, object, false, options), options)),
      );
    }

    return snapshot(ref.mapPath, object.metrics);
  }

  /**
   * Ручной прогон: кнопка свежесть не спрашивает, пайплайн идёт целиком.
   *
   * С `wait: false` вызов возвращает управление сразу, отдав `busy: true`. Прогон от этого
   * не прерывается — он живёт у стора, а не у вызова, — и досматривается обычным чтением.
   * Иначе дорогая метрика запускается вызовом, который обязан упасть по таймауту.
   */
  async function run(
    ref: MapRef,
    metricAddress: string,
    options: RunOptions & { wait?: boolean } = {},
  ): Promise<MetricValue> {
    const map = await readMap(ref);
    const found = findMetricOwner(map, metricAddress);
    if (!found) throw new Error(`Метрика ${metricAddress} не найдена`);
    const running = start(ref, found.metric, found.object, "all", options);
    if (options.wait !== false) await waitAtMost(running, options);
    return valueOf(entryOf(ref.mapPath, metricAddress));
  }

  return { watch, run, read };
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
