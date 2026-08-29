import type { Layout, MetricConfig } from "./schema.ts";

/** A metric as the sidebar needs it: config plus where it came from. */
export type MapMetric = {
  key: string;
  address: string;
  configPath: string;
  config: MetricConfig;
};

export type MapFile = { name: string; path: string };

/**
 * An object of the map. A folder without `_index.json` is a group: it holds children but is
 * not an object itself.
 */
export type MapObject = {
  address: string;
  path: string;
  name: string;
  prototypeName?: string;
  isGroup: boolean;
  props: Record<string, unknown>;
  previewSize?: { w: number; h: number };
  previewLayout?: Layout;
  detailsLayout?: Layout;
  metrics: MapMetric[];
  directives: MapFile[];
  actions: MapFile[];
  children: MapObject[];
};

export function findObject(root: MapObject, address: string): MapObject | undefined {
  if (root.address === address) return root;
  for (const child of root.children) {
    const found = findObject(child, address);
    if (found) return found;
  }
  return undefined;
}

/** Breadcrumbs are the chain of addresses from the root down to this object. */
export function trail(root: MapObject, address: string): MapObject[] {
  if (root.address === address) return [root];
  for (const child of root.children) {
    const inside = trail(child, address);
    if (inside.length > 0) return [root, ...inside];
  }
  return [];
}

/** Metrics live on objects, but the sidebar addresses them directly. */
export function findMetric(root: MapObject, address: string): MapMetric | undefined {
  const own = root.metrics.find((metric) => metric.address === address);
  if (own) return own;
  for (const child of root.children) {
    const found = findMetric(child, address);
    if (found) return found;
  }
  return undefined;
}

/** Which object a metric belongs to — `object-children-map` reads the model, not the disk. */
export function findMetricOwner(
  root: MapObject,
  address: string,
): { object: MapObject; metric: MapMetric } | undefined {
  const own = root.metrics.find((metric) => metric.address === address);
  if (own) return { object: root, metric: own };
  for (const child of root.children) {
    const found = findMetricOwner(child, address);
    if (found) return found;
  }
  return undefined;
}
