import type { MapAction, MapMetric } from "@mapward/core";

/**
 * Ключи, занятые и метрикой, и экшоном одного объекта. Раскладка находит клетку по ключу, и
 * такой ключ назвал бы две вещи сразу — это ошибка объекта, а не выбор, который делает вид.
 */
export function keyClashes(metrics: MapMetric[], actions: MapAction[]): string[] {
  const metricKeys = new Set(metrics.map((metric) => metric.key));
  return actions.map((action) => action.key).filter((key) => metricKeys.has(key));
}
