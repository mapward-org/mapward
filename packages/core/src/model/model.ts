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
  /**
   * The object that actually defines this metric, set only when it came from a prototype.
   * Absent on the object's own metrics, so its presence means one thing — this one is not
   * declared here. Decision 0015 asks for metrics on their own object; without this the
   * question cannot be answered from the outside at all.
   */
  owner?: string;
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

/** Где директива сейчас: этап начат вызовом MCP и им же закрывается — решение 0017. */
export type DirectiveRun = {
  stage: string;
  startedAt: string;
  finishedAt?: string;
};

export type MapFile = {
  name: string;
  path: string;
  status?: DirectiveStatus;
  /** Последний прогон этапа. У экшонов не бывает: состояние есть только у директив. */
  run?: DirectiveRun;
  /**
   * The object the file actually belongs to, set only when it came from a prototype. On its own
   * files it is absent: present, it means one thing — edit it there, not here.
   */
  owner?: string;
};

/**
 * Этап воркфлоу — файл в `_directives.workflow/`, frontmatter которого задаёт имя, порядок и
 * то, ставит ли этап отметку о выполнении. Решение 0017: способ работы с директивой задаёт
 * карта, а не код, поэтому этап — такой же наследуемый файл, как экшон.
 */
export type MapStage = {
  name: string;
  order: number;
  /** Этап, которому поручено помечать директиву выполненной. В дефолте это «Выполнить». */
  marksDone: boolean;
  path: string;
  /** Приехал от прототипа — как у директив и экшонов, и по той же причине. */
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
  /** Этапы, действующие на этом объекте: свои плюс унаследованные, по порядку. */
  workflow: MapStage[];
  /**
   * Промпт объекта: примешивается и к промпту терминала, и к промпту этапа — решение 0018.
   * Склеен по цепочке `extends`, общее сверху.
   */
  prompt?: string;
  /** Промпт, примешиваемый к любому этапу этого объекта — хук из `_index.json`. */
  workflowPrompt?: string;
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
