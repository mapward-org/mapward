import type { MapObject } from "../../pure-model/model.ts";
import { ago, toDisplay } from "../pure-model/display.ts";
import { planGrid } from "../pure-model/grid.ts";
import { useMetrics } from "../adapters/use-metrics.ts";
import { useViewState } from "../../adapters/use-view-state.ts";
import { Display } from "../ui/displays.tsx";
import { MetricCell } from "../ui/metric-cell.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

export function MetricGrid(props: {
  mapRef: Ref;
  object: MapObject;
  onOpen: (link: string) => void;
}) {
  const { values, busy, run } = useMetrics(props.mapRef, props.object.metrics);
  // Hiding is a per-person convenience: the editor remembers it, the repository never sees it.
  // What the person folded by hand wins over the metric's own `collapsed` — decision 0010.
  const [folded, setFolded] = useViewState<Record<string, boolean>>(
    `folded:${props.object.address}`,
    {},
  );
  const now = Date.now();

  const plan = planGrid(
    props.object.detailsLayout,
    props.object.metrics.map((metric) => metric.key),
  );

  const isFolded = (key: string, collapsed: boolean | undefined) => folded[key] ?? collapsed ?? false;
  const toggle = (key: string, collapsed: boolean | undefined) =>
    setFolded({ ...folded, [key]: !isFolded(key, collapsed) });

  return (
    <div
      className="grid h-full min-h-0 gap-2 p-2 pl-6"
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
            freshness={metric.config.collectorsCache ? ago(value?.updatedAt, now) : undefined}
            ok={value?.ok}
            busy={busy.has(metric.address)}
            hidden={isFolded(metric.key, metric.config.collapsed)}
            onRefresh={() => run(metric)}
            onToggle={() => toggle(metric.key, metric.config.collapsed)}
            onLogs={() =>
              props.onOpen(metric.configPath.replace(/config.json$/, "collect.logs.json"))
            }
          >
            <Display
              data={toDisplay(metric.config.display?.kind, value?.data)}
              collected={value?.data !== undefined}
              empty={metric.config.display?.empty}
              mapPath={props.mapRef.mapPath}
              address={metric.address}
              onOpen={props.onOpen}
            />
          </MetricCell>
        );
      })}
    </div>
  );
}
