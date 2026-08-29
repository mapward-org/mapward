import { useCallback, useEffect, useState } from "react";
import { useBridgeClient } from "@/kernel/bridge/context.tsx";
import type { MapMetric } from "../../pure-model/model.ts";

export type Collected = { updatedAt?: string; ok?: boolean; data?: unknown };

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Metrics are collected one by one and land as they arrive: a slow script must not hold up
 * the cells that are already done.
 */
export function useMetrics(ref: Ref, metrics: MapMetric[]) {
  const bridge = useBridgeClient();
  const [values, setValues] = useState<Record<string, Collected>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const run = useCallback(
    (metric: MapMetric) => {
      setBusy((previous) => new Set(previous).add(metric.address));
      void bridge
        .runMetric({ ...ref, metric: metric.address })
        .then((value) =>
          setValues((previous) => ({ ...previous, [metric.address]: value as Collected })),
        )
        .catch((error: unknown) =>
          setValues((previous) => ({
            ...previous,
            [metric.address]: { ok: false, data: { text: String(error) } },
          })),
        )
        .finally(() =>
          setBusy((previous) => {
            const next = new Set(previous);
            next.delete(metric.address);
            return next;
          }),
        );
    },
    [bridge, ref.mapPath, ref.basePath, ref.name],
  );

  useEffect(() => {
    for (const metric of metrics) {
      // `manual` waits for the button; everything else collects when the object is drawn.
      if (metric.config.refresh !== "manual") run(metric);
    }
    // Re-running on every metrics identity change would loop: addresses are the real key.
    // oxlint-disable-next-line exhaustive-deps
  }, [metrics.map((metric) => metric.address).join("|"), run]);

  return { values, busy, run };
}
