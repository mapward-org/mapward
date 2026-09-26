import type { Observable } from "rxjs";
import type { MapMetric, MapObject, RunSource } from "@mapward/core";
import type { Cancellation, OutputListener, ProcessEnv, ProcessResult } from "../../ports/index.ts";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Порты метрик к соседним фичам — решение 0041: объявляет их потребитель, поставщик им
 * соответствует, а стыкует сборка сервера. Метрики видят ровно то, что им нужно.
 */

/** От карты: объект с его метриками и дальше каждое изменение карты. */
export type MetricsMapSource = {
  current(ref: MapRef): Promise<MapObject>;
  /**
   * Живая карта — решение 0041. По ней вотчеры шагов следуют за конфигом (решение 0043); без
   * неё они ставятся по карте на момент открытия объекта.
   */
  watch?(ref: MapRef): Observable<MapObject>;
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
    output?: OutputListener;
  }): Promise<ProcessResult>;
  prompt(params: {
    owner?: MapObject;
    text: string;
    tail?: string;
    cwd: string;
    env: ProcessEnv;
    cancel?: Cancellation;
    output?: OutputListener;
  }): Promise<ProcessResult>;
};

/** Запись прогона метрики: стадии сообщает стор, хранит прогон фича прогонов (решение 0038). */
export type MetricRunRecord = {
  step(name: string): void;
  stepDone(status: "success" | "failure" | "stopped", log?: string, output?: unknown): void;
  /** Вывод идущей стадии по ходу — лог шага растёт на экране прогонов. */
  output(chunk: string, stream: "out" | "err"): void;
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
