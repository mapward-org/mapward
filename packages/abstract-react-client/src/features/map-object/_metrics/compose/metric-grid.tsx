import type { ReactNode } from "react";
import type { LinkNode, MapObject, MapRelation } from "@mapward/core";
import { ago, toDisplay } from "../pure-model/display.ts";
import { planGrid } from "../pure-model/grid.ts";
import { useMetrics } from "../adapters/use-metrics.ts";
import { useViewState } from "../../../../services/state/index.ts";
import { Display } from "../ui/displays.tsx";
import { MetricCell } from "../ui/metric-cell.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

export function MetricGrid(props: {
  mapRef: Ref;
  object: MapObject;
  onOpen: (link: string) => void;
  /** Карту детей рисует соседний подмодуль, а сводит их вместе `map-object/compose` (0015). */
  renderMap: (
    map: { nodes: LinkNode[]; relations: MapRelation[] },
    metricAddress: string,
  ) => ReactNode;
}) {
  const { values, busy, run } = useMetrics(
    props.mapRef,
    props.object.address,
    props.object.metrics,
  );
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

  const isFolded = (key: string, collapsed: boolean | undefined) =>
    folded[key] ?? collapsed ?? false;
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
            // `updatedAt` — время получения содержимого, а не чтения (0013), поэтому время
            // осмысленно и без файлового кэша: значение живёт в сторе и переживает уход
            // с объекта. Нет значения — `ago` сам вернёт ничего.
            freshness={ago(value?.updatedAt, now)}
            ok={value?.ok}
            busy={busy.has(metric.address)}
            hidden={isFolded(metric.key, metric.config.collapsed)}
            onRefresh={() => run(metric)}
            onToggle={() => toggle(metric.key, metric.config.collapsed)}
            onLogs={() => props.onOpen(`${metric.cachePath}/collect.logs.json`)}
          >
            <Display
              data={toDisplay(metric.config.display?.kind, value?.data)}
              collected={value?.data !== undefined}
              empty={metric.config.display?.empty}
              onOpen={props.onOpen}
              renderMap={(map) => props.renderMap(map, metric.address)}
            />
          </MetricCell>
        );
      })}
    </div>
  );
}
