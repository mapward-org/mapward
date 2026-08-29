import type { MetricConfig, ObjectIndex } from "./schema.ts";

/**
 * `{ ...prototype, ...own, props: { ...prototype.props, ...own.props } }` — decision 0003.
 * Shallow everywhere except props, which merge by key.
 */
export function mergeIndex(prototype: ObjectIndex, own: ObjectIndex): ObjectIndex {
  return {
    ...prototype,
    ...own,
    props: { ...prototype.props, ...own.props },
  };
}

/** Metrics inherit the same way, but have no props of their own. */
export function mergeMetric(prototype: MetricConfig, own: MetricConfig): MetricConfig {
  return { ...prototype, ...own };
}
