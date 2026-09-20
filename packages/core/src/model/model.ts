import { childAddress } from "./address.ts";
import type { Layout, MetricConfig, ObjectIndex } from "./schema.ts";

/**
 * Файл, участвовавший в мердже. Мердж разрушителен: по результату не видно, из чего он
 * собран, — а правят как раз слои. Поэтому цепочка лежит в модели, но лежит ссылками: адрес
 * и путь, без содержимого (решение 0019).
 */
export type ConfigLayer = {
  /** Чей это файл: адрес объекта или адрес метрики. */
  address: string;
  /** Сам файл: `config.json` у метрики, `_index.json` у объекта. */
  path: string;
  /** Откуда слой достался: свой файл, файл прототипа, файл по `extends`. */
  from: "own" | "prototype" | "extends";
};

/** Слои, доставшиеся от прототипа: то, что у него было своим, для наследника — прототипово. */
export const fromPrototype = (layers: ConfigLayer[]): ConfigLayer[] =>
  layers.map((layer) => (layer.from === "own" ? { ...layer, from: "prototype" as const } : layer));

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
  /** Файлы, из которых собран конфиг, от своего к дальнему прототипу. Первый — `configPath`. */
  layers: ConfigLayer[];
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
    // Файлы слоёв остаются прототиповы: конфиг взят у него, там его и правят.
    layers: fromPrototype(metric.layers),
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
  /** Стили карточки превью поверх умолчаний — решение 0003. */
  previewStyle?: Record<string, string>;
  /** `_index.json`, из которых собран объект, от своего к дальнему прототипу. У группы пусто. */
  layers: ConfigLayer[];
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
  /** Мерджить унаследованные этапы или заменить их целиком — решение 0017. Своё, не наследуется. */
  workflowMode?: "merge" | "replace";
  children: MapObject[];
};

/**
 * Мердж объекта обратно в вид `_index.json` — тот, по которому объект и нарисован. Собирается,
 * а не хранится: готовый мердж означал бы `props` в двух местах сразу, а подстановка идёт
 * по обоим, и они разъехались бы на первой же правке (решение 0019).
 *
 * `extends` берётся из слоёв: второй слой — это и есть прототип. Не разрешившийся `extends`
 * слоя не даёт, но такой объект и не унаследован вовсе, так что мердж о нём молчит честно.
 */
export function objectIndex(object: MapObject): ObjectIndex {
  const workflow = {
    ...(object.workflowMode === undefined ? {} : { mode: object.workflowMode }),
    ...(object.workflowPrompt === undefined ? {} : { prompt: object.workflowPrompt }),
  };
  const parent = object.layers[1]?.address;

  return {
    name: object.name,
    ...(parent === undefined ? {} : { extends: parent }),
    ...(Object.keys(object.props).length === 0 ? {} : { props: object.props }),
    ...(object.previewSize === undefined ? {} : { "preview-size": object.previewSize }),
    ...(object.previewLayout === undefined
      ? {}
      : { "preview-metrics-layout": object.previewLayout }),
    ...(object.detailsLayout === undefined
      ? {}
      : { "details-metrics-layout": object.detailsLayout }),
    ...(object.previewStyle === undefined ? {} : { "preview-style": object.previewStyle }),
    ...(object.prompt === undefined ? {} : { prompt: object.prompt }),
    ...(Object.keys(workflow).length === 0 ? {} : { "directives-workflow": workflow }),
  };
}

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
