import type { ActionConfig, MetricConfig, ObjectIndex } from "@mapward/core";

/** Keys the object did not set at all: spreading them would erase what the prototype gave. */
const stated = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;

/**
 * `{ ...prototype, ...own, props: { ...prototype.props, ...own.props } }` — decision 0003.
 * Shallow everywhere except props, which merge by key.
 *
 * "Own" means stated, not present: an object that says nothing about its layout inherits it.
 * Otherwise the grid came out empty and every metric landed in the same cell.
 */
export function mergeIndex(prototype: ObjectIndex, own: ObjectIndex): ObjectIndex {
  return {
    ...prototype,
    ...stated(own),
    props: { ...prototype.props, ...own.props },
  };
}

/**
 * Метрика — поверх целиком, кроме `params` компонента: они сливаются по имени, как у экшона.
 * Иначе наследник, который только свернул метрику (`{ "params": { "collapsed": true } }`), молча
 * терял бы её источник.
 */
export function mergeMetric(prototype: MetricConfig, own: MetricConfig): MetricConfig {
  const merged = { ...prototype, ...stated(own) };
  return prototype.params === undefined && own.params === undefined
    ? merged
    : { ...merged, params: { ...prototype.params, ...own.params } };
}

/**
 * Экшон — как метрика, кроме полей формы и параметров метода: они сливаются по имени. Иначе
 * наследник, добавивший одно поле или задавший один параметр, молча терял бы остальные.
 */
export function mergeAction(prototype: ActionConfig, own: ActionConfig): ActionConfig {
  const merged = { ...prototype, ...stated(own) };
  return {
    ...merged,
    ...(prototype.inputs === undefined && own.inputs === undefined
      ? {}
      : { inputs: { ...prototype.inputs, ...own.inputs } }),
    ...(prototype.params === undefined && own.params === undefined
      ? {}
      : { params: { ...prototype.params, ...own.params } }),
  };
}
