import type {
  ConfigLayer,
  MapAction,
  MapFile,
  MapMetric,
  MapObject,
  MapStage,
} from "@mapward/core";
import { matchDirectives } from "../../../kernel/directives.ts";
import { matches } from "../../../kernel/search.ts";

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

/**
 * Подпись кнопки слоя: чей это файл. Своё так и зовётся, чужое — именем объекта или адресом.
 * Объект ищется по адресу, а не обходом карты: подписи нужен один объект, а не все.
 */
export function layerLabel(
  find: (address: string) => { name: string } | undefined,
  layer: ConfigLayer,
): string {
  if (layer.from === "own") return "свой";
  const where = layerOwner(layer.address);
  if (layer.from === "prototype") return find(where)?.name ?? where;
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

/** Строки раздела «Объект» под его названием: где он лежит, а затем поля `props`. */
export const fieldRows = (object: MapObject): { key: string; value: string }[] => [
  { key: "адрес", value: object.address },
  { key: "на диске", value: object.path },
  ...propRows(object.props),
];

/** Что осталось на мета-экране после поиска: по разделу — только совпавшие строки. */
export type MetaFound = {
  /** Раздел «Объект» виден: совпало его имя или хотя бы одна строка под ним. */
  object: boolean;
  fields: { key: string; value: string }[];
  metrics: MapMetric[];
  workflow: MapStage[];
  actions: MapAction[];
  directives: MapFile[];
  /** Запрос набран, и не совпало ни в одном разделе. */
  nothing: boolean;
};

/**
 * Поиск по мета-экрану: в каждом разделе сравнивается то, что в строке видно, — название, а у
 * метрики и экшона ещё ключ, по которому их зовут. Подсказки справа («из прототипа», «по
 * умолчанию») и всплывающие описания не ищутся: это не название, и на «прото» совпало бы
 * полкарты. Директива ищется по имени файла целиком, вместе с датой.
 */
export function searchMeta(object: MapObject, query: string): MetaFound {
  const fields = fieldRows(object).filter((row) => matches(query, row.key, row.value));
  const found = {
    object: matches(query, object.name) || fields.length > 0,
    fields,
    metrics: object.metrics.filter((metric) => matches(query, metric.config.label, metric.key)),
    workflow: object.workflow.filter((stage) => matches(query, stage.name)),
    actions: object.actions.filter((action) => matches(query, action.config.label, action.key)),
    directives: matchDirectives(object.directives, query),
  };
  const nothing =
    !found.object &&
    found.metrics.length === 0 &&
    found.workflow.length === 0 &&
    found.actions.length === 0 &&
    found.directives.length === 0;
  return { ...found, nothing };
}
