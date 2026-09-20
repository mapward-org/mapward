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
export function useMetrics(
  ref: Ref,
  address: string,
  metrics: MapMetric[],
  view: { group?: string; solo?: string } = {},
) {
  const bridge = useBridgeClient();
  // Вкладка — это и есть «что открыто»: её имя едет в подписку, и сервер собирает только её
  // метрики (решение 0025). Таб одной метрики называет её ключ и поднимает её одну (0026).
  const solo = view.solo;
  const group = view.group;

  const values =
    (useObservable(
      () =>
        bridge.watchMetrics({
          ...ref,
          address,
          ...(group === undefined ? {} : { group }),
          ...(solo === undefined ? {} : { metrics: [solo] }),
        }),
      [ref.mapPath, ref.basePath, ref.name, address, group, solo],
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
