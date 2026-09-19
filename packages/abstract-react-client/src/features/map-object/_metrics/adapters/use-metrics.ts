import { useCallback } from "react";
import { useBridgeClient } from "../../../../ports/bridge.tsx";
import { useObservable } from "../../../../lib/rxjs-react/index.ts";
import type { MapMetric } from "@mapward/core";

export type Collected = { updatedAt?: string; ok?: boolean; data?: unknown; busy?: boolean };
export type Snapshot = Record<string, Collected>;

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Значения приходят из стора сервера, а не считаются здесь — решение 0013. Сама подписка и
 * означает «объект открыт»: пока она жива, сервер держит метрики свежими и тикает интервалами,
 * а отписка гасит таймеры. Поэтому переход по карте не пересобирает уже собранное, а второй
 * вид того же объекта видит то же самое, включая идущий прогон.
 */
export function useMetrics(ref: Ref, address: string, metrics: MapMetric[]) {
  const bridge = useBridgeClient();

  const values =
    (useObservable(
      () => bridge.watchMetrics({ ...ref, address }),
      [ref.mapPath, ref.basePath, ref.name, address],
    ) as Snapshot | undefined) ?? {};

  const run = useCallback(
    (metric: MapMetric) => void bridge.runMetric({ ...ref, metric: metric.address }),
    [bridge, ref.mapPath, ref.basePath, ref.name],
  );

  const busy = new Set(
    metrics.filter((metric) => values[metric.address]?.busy).map((metric) => metric.address),
  );

  return { values, busy, run };
}
