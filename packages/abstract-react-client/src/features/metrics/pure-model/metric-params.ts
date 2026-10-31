import type { MapMetric, MapObject } from "@mapward/core";

/** Чьи `params` перекрыть и чем: снимаемая метрика страницы снимка. */
export type ParamsOverride = { object: string; metric: string; params: Record<string, unknown> };

/**
 * `params` метрики, какими их получает компонент: из `config.json`, а на странице снимка у
 * снимаемой метрики — с перекрытием поверх, слиянием по ключу. Файлы карты не трогаются.
 */
export function metricParams(
  object: MapObject,
  metric: MapMetric,
  override: ParamsOverride | undefined,
): Record<string, unknown> {
  const own = metric.config.params ?? {};
  if (!override || override.object !== object.address || override.metric !== metric.key) {
    return own;
  }
  return { ...own, ...override.params };
}
