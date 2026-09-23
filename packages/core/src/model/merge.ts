import type { ActionConfig, MetricConfig, ObjectIndex } from "./schema.ts";

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

/** Metrics inherit the same way, but have no props of their own. */
export function mergeMetric(prototype: MetricConfig, own: MetricConfig): MetricConfig {
  return { ...prototype, ...stated(own) };
}

/**
 * Экшон — как метрика, кроме полей формы: они сливаются по имени. Иначе наследник, добавивший
 * одно поле, молча терял бы все поля общего экшона.
 */
export function mergeAction(prototype: ActionConfig, own: ActionConfig): ActionConfig {
  const merged = { ...prototype, ...stated(own) };
  return prototype.inputs === undefined && own.inputs === undefined
    ? merged
    : { ...merged, inputs: { ...prototype.inputs, ...own.inputs } };
}
