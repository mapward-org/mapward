import { useId, type ReactNode } from "react";
import type { Layout, LinkNode, MapMetric, MapObject, MapRelation } from "@mapward/core";
import { ago, toDisplay } from "../pure-model/display.ts";
import { cellAttribute, planGrid, soloGrid } from "../pure-model/grid.ts";
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
  // Правила сетки лежат под своим классом: две сетки на экране не должны задевать друг друга.
  const scope = `mw-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const solo = props.solo === undefined ? undefined : soloGrid(props.solo);
  const plan = solo
    ? undefined
    : planGrid(
        props.layout,
        props.metrics.map((metric) => metric.key),
        scope,
      );
  const placed = solo?.placed ?? plan?.placed;

  /**
   * Раскладка есть — показываются метрики, которые в ней названы, и только они (решение 0029).
   * Отбор идёт до подписки: невидимая метрика не собирается, как метрика вне вкладки.
   */
  const metrics = placed ? props.metrics.filter((metric) => placed.has(metric.key)) : props.metrics;

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

  /**
   * Высоту сетке код не задаёт (решение 0033): она растёт по содержимому, а прокручивается
   * область вокруг. Растянуть её на всю высоту раскладка может сама — `height: 100%` в `style`.
   * Таб одной метрики — исключение: там метрика и есть весь экран.
   */
  return (
    <div
      // `content-start` прижимает ряды кверху, когда сетке досталось больше места, чем нужно
      // метрикам: иначе css растягивает ряды `auto` на весь остаток. Ряд `1fr` это не трогает.
      className={`${scope} grid content-start gap-2 p-2 pl-6 ${solo ? "h-full min-h-0" : ""}`}
      {...(solo
        ? { style: { gridTemplateColumns: solo.columns, gridTemplateRows: solo.rows } }
        : {})}
    >
      {plan && <style>{plan.css}</style>}
      {metrics.map((metric) => {
        const value = values[metric.address];
        return (
          <MetricCell
            key={metric.address}
            // Место клетке назначает css раскладки, находя её по ключу метрики.
            cell={{ [cellAttribute]: metric.key }}
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
