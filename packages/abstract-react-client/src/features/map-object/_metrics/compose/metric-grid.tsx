import type { ReactNode } from "react";
import type { Layout, LinkNode, MapMetric, MapObject, MapRelation } from "@mapward/core";
import { ago, toDisplay } from "../pure-model/display.ts";
import { planGrid, soloGrid } from "../pure-model/grid.ts";
import { useMetrics } from "../adapters/use-metrics.ts";
import { useViewState } from "../../../../services/state/index.ts";
import { Display } from "../ui/displays.tsx";
import { MetricCell } from "../ui/metric-cell.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

export function MetricGrid(props: {
  mapRef: Ref;
  object: MapObject;
  /** Метрики открытой вкладки: что показать, решает группа, а не сетка — решение 0025. */
  metrics: MapMetric[];
  /** Раскладка вкладки: своя у группы, иначе объекта. */
  layout?: Layout;
  /** Имя открытой вкладки — оно же едет в подписку: закрытая вкладка не собирается. */
  group?: string;
  /**
   * Одна метрика во всю ширину — таб метрики (решение 0026). Сетка тогда не раскладывается:
   * раскладывать нечего, и лишние клетки съели бы место, ради которого таб и открывали.
   */
  solo?: string;
  onOpen: (link: string) => void;
  /** Открыть метрику отдельным табом; хост не умеет табы — параметра нет, и иконок тоже. */
  onOpenTab?: (metric: MapMetric) => void;
  /** Открыть табом объект, на который ведёт ссылка внутри метрики — то же решение 0026. */
  onOpenObjectTab?: (link: string) => void;
  /** Карту детей рисует соседний подмодуль, а сводит их вместе `map-object/compose` (0015). */
  renderMap: (
    map: { nodes: LinkNode[]; relations: MapRelation[] },
    metricAddress: string,
  ) => ReactNode;
}) {
  const plan = props.solo
    ? soloGrid(props.solo)
    : planGrid(
        props.layout,
        props.metrics.map((metric) => metric.key),
      );

  /**
   * Раскладка есть — показываются метрики, которые в ней названы, и только они (решение 0029).
   * Отбор идёт до подписки: невидимая метрика не собирается, как метрика вне вкладки.
   */
  const metrics = plan
    ? props.metrics.filter((metric) => plan.placed.has(metric.key))
    : props.metrics;

  const { values, busy, run } = useMetrics(props.mapRef, props.object.address, metrics, {
    ...(props.group === undefined ? {} : { group: props.group }),
    ...(props.solo === undefined ? {} : { solo: props.solo }),
  });
  // Hiding is a per-person convenience: the editor remembers it, the repository never sees it.
  // What the person folded by hand wins over the metric's own `collapsed` — decision 0010.
  const [folded, setFolded] = useViewState<Record<string, boolean>>(
    `folded:${props.object.address}`,
    {},
  );
  const now = Date.now();

  const isFolded = (key: string, collapsed: boolean | undefined) =>
    // В табе одной метрики свёрнутость не спрашивается: таб открыт ради того, чтобы её видеть.
    props.solo === key ? false : (folded[key] ?? collapsed ?? false);
  const toggle = (key: string, collapsed: boolean | undefined) =>
    setFolded({ ...folded, [key]: !isFolded(key, collapsed) });

  return (
    <div
      className="grid h-full min-h-0 gap-2 p-2 pl-6"
      style={{
        gridTemplateAreas: plan?.areas,
        gridTemplateColumns: plan?.columns,
        gridTemplateRows: plan?.rows,
        ...plan?.style,
      }}
    >
      {metrics.map((metric) => {
        const value = values[metric.address];
        return (
          <MetricCell
            key={metric.address}
            // Клетка называет область только там, где области есть: иначе она ищет линию с
            // этим именем, не находит и встаёт куда придётся, вместо того чтобы занять трек.
            {...(plan?.areas === undefined ? {} : { gridArea: metric.key })}
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
            {...(props.onOpenTab === undefined || props.solo !== undefined
              ? {}
              : { onOpenTab: () => props.onOpenTab?.(metric) })}
          >
            <Display
              data={toDisplay(metric.config.display?.kind, value?.data)}
              collected={value?.data !== undefined}
              empty={metric.config.display?.empty}
              onOpen={props.onOpen}
              {...(props.onOpenObjectTab === undefined ? {} : { onOpenTab: props.onOpenObjectTab })}
              renderMap={(map) => props.renderMap(map, metric.address)}
            />
          </MetricCell>
        );
      })}
    </div>
  );
}
