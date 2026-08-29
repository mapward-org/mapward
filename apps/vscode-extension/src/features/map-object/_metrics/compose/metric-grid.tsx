import { useState } from "react";
import type { MapObject } from "../../pure-model/model.ts";
import { ago, toDisplay } from "../pure-model/display.ts";
import { planGrid } from "../pure-model/grid.ts";
import { useMetrics } from "../adapters/use-metrics.ts";
import { Display } from "../ui/displays.tsx";
import { MetricCell } from "../ui/metric-cell.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

export function MetricGrid(props: {
  mapRef: Ref;
  object: MapObject;
  onOpen: (link: string) => void;
}) {
  const { values, busy, run } = useMetrics(props.mapRef, props.object.metrics);
  // Hiding is a per-viewer convenience, so it lives in the webview, not in the repository.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const now = Date.now();

  const plan = planGrid(
    props.object.detailsLayout,
    props.object.metrics.map((metric) => metric.key),
  );

  const toggle = (key: string) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div
      className="grid gap-2 p-2"
      style={{
        gridTemplateAreas: plan?.areas,
        gridTemplateColumns: plan?.columns,
        ...plan?.style,
      }}
    >
      {props.object.metrics.map((metric) => {
        const value = values[metric.address];
        return (
          <MetricCell
            key={metric.address}
            gridArea={metric.key}
            label={metric.config.label ?? metric.key}
            freshness={ago(value?.updatedAt, now)}
            ok={value?.ok}
            busy={busy.has(metric.address)}
            hidden={hidden.has(metric.key)}
            onRefresh={() => run(metric)}
            onToggle={() => toggle(metric.key)}
            onLogs={() =>
              props.onOpen(metric.configPath.replace(/config.json$/, "collect.logs.json"))
            }
          >
            <Display
              data={toDisplay(metric.config.display?.kind, value?.data)}
              onOpen={props.onOpen}
            />
          </MetricCell>
        );
      })}
    </div>
  );
}
