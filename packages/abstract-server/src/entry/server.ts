import { Observable } from "rxjs";
import type { MapObject } from "@mapward/core";
import type { ServerPorts } from "../ports/index.ts";
import { readMap } from "../features/map-object/application/use-cases/read-map.ts";
import {
  createMetricStore,
  type MapRef,
  type ReadOptions,
  type RunOptions,
} from "../features/map-object/application/services/metric-store.ts";
import { createDirective } from "../features/map-object/application/use-cases/directives.ts";
import {
  readMapState,
  writeMapState,
} from "../features/map-object/application/use-cases/map-state.ts";

export type MapServer = ReturnType<typeof createMapServer>;

/**
 * Сервер карты: юзкейсы, собранные вместе — решение 0015.
 *
 * Ничего платформенного здесь нет, всё приходит портами. Поэтому один и тот же сервер живёт в
 * расширении и в cli, а его подписки одинаково работают через любой транспорт.
 */
export type ServerSettings = {
  /** Сколько метрик собирать разом; без него — без лимита (решение 0013). */
  metricsConcurrency?: number;
  /**
   * Сколько собранное считается свежим — умолчание для всех метрик карты, которое метрика
   * перебивает своим (решение 0016). Без него каждое открытие пересобирает всё заново.
   */
  collectorsStaleTime?: number;
  transformsStaleTime?: number;
};

export function createMapServer(ports: ServerPorts, settings: ServerSettings = {}) {
  const read = (ref: MapRef) => readMap(ports.files, ref.mapPath, ref.basePath, ref.name);
  const metrics = createMetricStore(ports, read, settings);

  return {
    capabilities: () => ports.capabilities,

    getMap: (ref: MapRef): Promise<MapObject> => read(ref),

    /**
     * Карту правят руками и агентами, поэтому источник истины — файловая система. Свои же
     * записи — кэши метрик и положение узлов — вотчер пропускает: иначе запись вызывала бы
     * перечитывание, оно новый сбор, а тот новую запись.
     */
    watchMap: (ref: MapRef): Observable<MapObject> =>
      new Observable((subscriber) => {
        const push = () => void read(ref).then((map) => subscriber.next(map));
        const stop = ports.files.watch(ref.mapPath, (path) => {
          if (!ourOwnWrite(path)) push();
        });
        push();
        return stop;
      }),

    watchMetrics: (params: MapRef & { address?: string }) => metrics.watch(params, params.address),

    runMetric: (params: MapRef & { metric: string } & RunOptions) =>
      metrics.run(params, params.metric, params),

    /**
     * Что показано сейчас: этим MCP отдаёт метрики в собранном виде. Без опций — только кэш,
     * с `refresh: "on-display"` дешёвое досчитывается (решение 0016).
     */
    readMetrics: (ref: MapRef, object: MapObject, options?: ReadOptions) =>
      metrics.read(ref, object, options),

    /** Объект файлом, как он написан на диске — решение 0009: агент видит и мердж, и исходник. */
    readIndexFile: (objectPath: string) => ports.files.read(`${objectPath}/_index.json`),

    createDirective: (params: { objectPath: string; title: string }) =>
      createDirective(ports, params),

    getMapState: (params: { mapPath: string }) => readMapState(ports, params),
    setMapState: (params: { mapPath: string; value: unknown }) => writeMapState(ports, params),
  };
}

/** Файлы, которые пишет сама карта: их изменение не повод перечитывать её заново. */
const ourOwnWrite = (path: string) =>
  /(collect|transform)(\.logs)?\.json$|map-state\.json$/.test(path.replaceAll("\\", "/"));
