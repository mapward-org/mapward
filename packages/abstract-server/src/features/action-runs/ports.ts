import type { ActionPermissions, MapObject } from "@mapward/core";
import type { Cancellation, OutputListener, ProcessEnv, ProcessResult } from "../../ports/index.ts";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Порты прогонов к соседним фичам — решение 0041: объявляет потребитель, стыкует сборка сервера.
 */

/** От карты: экшон и объект, на котором его нажали. */
export type RunsMapSource = {
  current(ref: MapRef): Promise<MapObject>;
};

/** От запуска: скрипт и агент — тем же кодом, что у метрик (решение 0038). */
export type RunsExecutor = {
  script(params: {
    command: string;
    cwd: string;
    env: ProcessEnv;
    input?: string;
    cancel?: Cancellation;
    output?: OutputListener;
  }): Promise<ProcessResult>;
  prompt(params: {
    owner?: MapObject;
    text: string;
    tail?: string;
    cwd: string;
    env: ProcessEnv;
    cancel?: Cancellation;
    permissions?: ActionPermissions;
    output?: OutputListener;
  }): Promise<ProcessResult>;
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
 * От ленты активности в кружке сайдбара (решение 0034): экшон запущен и кончился. Метрики сюда не
 * пишут — они собираются сами, и лента утонула бы в них.
 */
export type RunsActivity = {
  actionStarted(turn: RunsActivityTurn): void;
  actionEnded(turn: RunsActivityTurn, failed: boolean): void;
};

/** От метрик: пересобрать метрику после успешного экшона. */
export type RunsMetricRefresh = {
  run(ref: MapRef, address: string): Promise<unknown>;
};
