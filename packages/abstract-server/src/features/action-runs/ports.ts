import type { MapObject } from "@mapward/core";
import type { Observable } from "rxjs";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Порты прогонов к соседним фичам — решение 0041: объявляет потребитель, стыкует сборка сервера.
 */

/** От карты: объект, на котором нажали экшон, — по адресу, без детей. */
export type RunsMapSource = {
  object(ref: MapRef, address: string): Promise<MapObject | undefined>;
};

/**
 * От плагинов: экшон — изменяющий метод плагина. Самоописание нужно ради схемы параметров —
 * из неё строится форма; вызов — поток, отписка от него — остановка.
 */
export type RunsPlugins = {
  describe(
    ref: MapRef,
    plugin: string,
  ): Promise<{ methods: Record<string, { params?: unknown } | undefined> }>;
  call(ref: MapRef, plugin: string, method: string, args: unknown): Observable<unknown>;
};

/** Пункт ленты про прогон экшона: где он, чей и как зовётся. */
export type RunsActivityTurn = {
  mapPath: string;
  address: string;
  object: string;
  run: string;
  label: string;
  at: string;
};

/**
 * От ленты активности в кружке сайдбара (решение 0034): прогон запущен и кончился. Экшоны пишут
 * всегда; метрика — только ручная и запущенная человеком или агентом: сами они собираются часто,
 * и лента утонула бы в них.
 */
export type RunsActivity = {
  actionStarted(turn: RunsActivityTurn, kind?: "action" | "metric"): void;
  actionEnded(turn: RunsActivityTurn, failed: boolean, kind?: "action" | "metric"): void;
};
