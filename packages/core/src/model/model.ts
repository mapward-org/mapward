import { childAddress } from "./address.ts";
import type { Layout, MetricConfig } from "./schema.ts";

/** A metric as the sidebar needs it: config plus where it came from. */
export type MapMetric = {
  key: string;
  address: string;
  /** Where the config was read from — it may belong to a prototype. */
  configPath: string;
  /** Where caches and logs of this metric live — always the object's own folder. */
  cachePath: string;
  config: MetricConfig;
};

/**
 * A metric inherited from a prototype belongs to the heir: the config is borrowed, the state is
 * not — decision 0002. Left with the prototype's address, every heir shares one entry: caches
 * land in the prototype's folder, and the object that runs the metric is whichever the search
 * finds first, so the whole map shows one object's numbers.
 */
export function adoptMetric(
  object: { address: string; path: string },
  metric: MapMetric,
): MapMetric {
  return {
    ...metric,
    address: `${childAddress(object.address, "_metrics")}/${metric.key}`,
    cachePath: `${object.path}/_metrics/${metric.key}`,
  };
}

export type DirectiveStatus = "new" | "changed" | "done";

export type MapFile = {
  name: string;
  path: string;
  status?: DirectiveStatus;
  /**
   * The object the file actually belongs to, set only when it came from a prototype. On its own
   * files it is absent: present, it means one thing — edit it there, not here.
   */
  owner?: string;
};

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
