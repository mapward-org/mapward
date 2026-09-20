import { findObject } from "@mapward/core";
import type { ConfigLayer, MapMetric, MapObject } from "@mapward/core";

/**
 * Откуда конфиг — одним словом. Своё молчит: подсказка стоит в той же строке, что название,
 * и забирает ширину у него первой. Какой именно прототип и какая общая — написано на кнопках
 * слоёв под строкой, там место есть (решение 0019).
 */
export function originHint(layers: ConfigLayer[]): string | undefined {
  if (layers.some((layer) => layer.from === "prototype")) return "из прототипа";
  return layers.some((layer) => layer.from === "extends") ? "из общей" : undefined;
}

/** Адрес слоя метрики ведёт в её папку, а файл написал объект — он двумя сегментами выше. */
export const layerOwner = (address: string) => address.replace(/\/_metrics\/[^/]+$/, "");

/** Подпись кнопки слоя: чей это файл. Своё так и зовётся, чужое — именем объекта или адресом. */
export function layerLabel(map: MapObject, layer: ConfigLayer): string {
  if (layer.from === "own") return "свой";
  const where = layerOwner(layer.address);
  if (layer.from === "prototype") return findObject(map, where)?.name ?? where;
  return where.replace("mapward://", "");
}

/** Вид коллектора схемой не сужен — он просто строка (решение 0004), поэтому берём её осторожно. */
const kinds = (list?: Record<string, unknown>[]) =>
  [...new Set((list ?? []).map((one) => one["kind"]))].filter(
    (kind): kind is string => typeof kind === "string",
  );

/** Чем метрика собирается — одной строкой: за этим конфиг и открывают. */
export function howCollected(metric: MapMetric): string {
  return [
    metric.config.refresh ?? "manual",
    ...kinds(metric.config.collectors),
    ...kinds(metric.config.transforms),
    metric.config.display?.kind ?? "без дисплея",
  ].join(" · ");
}

/** Чей файл этапа или экшона: свой молчать не умеет — у него этой подписи просто нет. */
export const ownerHint = (owner?: string) => owner?.replace("mapward://", "");

/**
 * `props` после наследования и подстановок — таблицей «ключ — значение». Значения бывают
 * длинными путями, поэтому строка режется по ширине, а целиком висит тултипом.
 */
export const propRows = (props: Record<string, unknown>): { key: string; value: string }[] =>
  Object.entries(props).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
