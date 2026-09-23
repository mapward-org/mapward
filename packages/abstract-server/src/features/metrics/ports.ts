import type { MapMetric, MapObject, RunSource } from "@mapward/core";
import type { Cancellation, ProcessEnv, ProcessResult } from "../../ports/index.ts";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Порты метрик к соседним фичам — решение 0041: объявляет их потребитель, поставщик им
 * соответствует, а стыкует сборка сервера. Метрики видят ровно то, что им нужно.
 */

/** От карты: объект с его метриками. */
export type MetricsMapSource = {
  current(ref: MapRef): Promise<MapObject>;
};

type Display = MapMetric["config"]["display"];

/** От дисплеев: что сказать агенту о форме ответа и прошли ли данные схему компонента. */
export type MetricsDisplaySchema = {
  hint(display: Display): Promise<string>;
  check(display: Display, data: unknown): Promise<string[]>;
};

/** От запуска: скрипт и агент. */
export type MetricsExecutor = {
  script(params: {
    command: string;
    cwd: string;
    env: ProcessEnv;
    input?: string;
    cancel?: Cancellation;
  }): Promise<ProcessResult>;
  prompt(params: {
    owner?: MapObject;
    text: string;
    tail?: string;
    cwd: string;
    env: ProcessEnv;
    cancel?: Cancellation;
  }): Promise<ProcessResult>;
};

/** Запись прогона метрики: стадии сообщает стор, хранит прогон фича прогонов (решение 0038). */
export type MetricRunRecord = {
  step(name: string): void;
  stepDone(status: "success" | "failure" | "stopped", log?: string, output?: unknown): void;
  end(status: "success" | "failure" | "stopped", error?: string): void;
};

/** Куда стор сообщает о прогонах: историю метрик держит хранилище прогонов (решение 0038). */
export type MetricHistory = {
  recordMetric(
    mapPath: string,
    info: { target: string; object: string; label: string; source: RunSource; config: unknown },
    cancel?: () => void,
  ): MetricRunRecord;
};
