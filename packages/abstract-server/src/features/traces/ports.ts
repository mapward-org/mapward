import type { LogFilter, LogLine, MapObject, TraceRef } from "@mapward/core";
import type { Observable } from "rxjs";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Порты трейсов к соседним фичам — решение 0041: объявляет потребитель, стыкует сборка сервера.
 */

/** От карты: объект, на котором нажали экшон, — по адресу, без детей. */
export type TracesMapSource = {
  object(ref: MapRef, address: string): Promise<MapObject | undefined>;
};

/**
 * От плагинов: экшон — изменяющий метод плагина. Самоописание нужно ради схемы параметров —
 * из неё строится форма; вызов — поток в трейсе, отписка от него — остановка.
 */
export type TracesPlugins = {
  describe(
    ref: MapRef,
    plugin: string,
  ): Promise<{ methods: Record<string, { params?: unknown } | undefined> }>;
  call(
    ref: MapRef,
    plugin: string,
    method: string,
    args: unknown,
    trace?: TraceRef,
  ): Observable<unknown>;
  cancelTrace(trace: string): void;
  nextId(prefix: string): string;
};

/** От логов: начала и концы трейсов пишутся туда, прогоны оттуда же и читаются. */
export type TracesLogs = {
  write(mapPath: string, line: LogLine): void;
  read(mapPath: string, filter: LogFilter, limit?: number): Promise<LogLine[]>;
  watch(mapPath: string, filter: LogFilter, limit?: number): Observable<LogLine[]>;
};

/** Пункт ленты про прогон экшона: где он, чей и как зовётся. */
export type TracesActivityTurn = {
  mapPath: string;
  address: string;
  object: string;
  run: string;
  label: string;
  at: string;
};

/** От ленты активности в кружке сайдбара (решение 0034): экшон запущен и кончился. */
export type TracesActivity = {
  actionStarted(turn: TracesActivityTurn): void;
  actionEnded(turn: TracesActivityTurn, failed: boolean): void;
};
