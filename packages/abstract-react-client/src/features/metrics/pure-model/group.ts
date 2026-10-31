import type { MapMetric, MapObject, MetricGroup } from "@mapward/core";

/** Метрика группы для раскладки — `LayoutMetric` набора, с узлом любого вида. */
export type LayoutMetricOf<N> = { key: string; label: string; node: N };

/** Пропсы раскладки группы — `LayoutProps` набора `@mapward/component`. */
export type LayoutPropsOf<N> = {
  metrics: Record<string, LayoutMetricOf<N>>;
  list: LayoutMetricOf<N>[];
  object: { address: string; name: string; path: string; props: Record<string, unknown> };
  group: { key: string; label: string };
};

export const metricLabel = (metric: MapMetric): string => metric.config.label ?? metric.key;

/**
 * Что получает раскладка группы: метрики по ключу и списком в порядке группы. Узел метрики
 * рисует вызывающий — здесь только раскладывается, где какой лежит.
 */
export function layoutProps<N>(
  object: MapObject,
  group: MetricGroup,
  metrics: MapMetric[],
  node: (metric: MapMetric) => N,
): LayoutPropsOf<N> {
  const list = metrics.map((metric) => ({
    key: metric.key,
    label: metricLabel(metric),
    node: node(metric),
  }));
  return {
    metrics: Object.fromEntries(list.map((entry) => [entry.key, entry])),
    list,
    object: { address: object.address, name: object.name, path: object.path, props: object.props },
    group: { key: group.key, label: group.label ?? group.key },
  };
}
