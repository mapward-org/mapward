import { childAddress, mapAddress, parseAddress, readField } from "./address.ts";
import { defaultStages } from "./default-workflow.ts";
import { mergeAction, mergeIndex, mergeMetric } from "./merge.ts";
import { adoptAction, adoptMetric, fromPrototype } from "./model.ts";
import type { MapAction, MapFile, MapMetric, MapObject, MapStage } from "./model.ts";
import type { OwnIndex } from "./raw-object.ts";
import type { MetricGroup } from "./schema.ts";
import { substituteDeep, type Resolve } from "./substitution.ts";

/**
 * Сборка объекта из своего и прототипова — чистые функции (решения 0041 и 0042). Объект
 * собирается по частям: индекс, метрики, экшоны, директивы, этапы. Каждая часть — из своей
 * части объекта и той же части уже собранного прототипа, поэтому чтение имени не тянет за собой
 * директивы, а правка директивы не пересобирает метрики. Дерево здесь не обходится: его
 * обходит живая модель.
 */

/** Часть объекта, которую собирает индекс: всё, кроме списков и детей. */
export type IndexPart = Omit<
  MapObject,
  "children" | "metrics" | "actions" | "directives" | "workflow"
>;

/** Кто объект для подстановок и для слоёв наследника: адрес, путь, имя и свойства. */
export type Named = Pick<MapObject, "address" | "path" | "name" | "props">;

/**
 * Унаследованный файл помечается владельцем: лежит он у прототипа, и править его надо там.
 * Свой файл поля не получает — ставить его на себя значило бы шуметь в каждом ответе.
 * Владелец сохраняется из цепочки: прототип мог сам получить файл выше.
 */
const byName = (inherited: MapFile[], own: MapFile[], from: string): MapFile[] => {
  const mine = new Set(own.map((file) => file.name));
  return [
    ...inherited
      .filter((file) => !mine.has(file.name))
      .map((file) => (file.owner ? file : { ...file, owner: from })),
    ...own,
  ];
};

/**
 * Группы метрик сливаются по ключу: своя группа с тем же ключом переопределяет прототипову
 * целиком — решение 0025. Порядок вкладок задаёт прототип, свои новые встают следом.
 */
const byGroup = (inherited: MetricGroup[], own: MetricGroup[]): MetricGroup[] => {
  const mine = new Map(own.map((group) => [group.key, group]));
  return [
    ...inherited.map((group) => mine.get(group.key) ?? group),
    ...own.filter((group) => !inherited.some((parent) => parent.key === group.key)),
  ];
};

/** Этапы сливаются по имени, как файлы, и пересортировываются: порядок задан frontmatter. */
const byStage = (inherited: MapStage[], own: MapStage[], from: string): MapStage[] => {
  const mine = new Set(own.map((stage) => stage.name));
  return [
    ...inherited
      .filter((stage) => !mine.has(stage.name))
      .map((stage) => (stage.owner ? stage : { ...stage, owner: from })),
    ...own,
  ].toSorted((a, b) => a.order - b.order);
};

/**
 * Общее с дальнего прототипа сверху, своё снизу — решение 0018. Склеивается унаследованное с
 * тем, что объект написал сам, а не с тем, что у него уже получилось.
 */
const joinPrompts = (inherited?: string, own?: string): string | undefined => {
  const parts = [inherited, own].filter((part) => part !== undefined && part !== "");
  return parts.length === 0 ? undefined : parts.join("\n\n");
};

/** Индекс объекта без прототипа — ровно то, что он написал сам. */
function aloneIndex(own: OwnIndex): IndexPart {
  return {
    address: own.address,
    path: own.path,
    name: own.name,
    isGroup: own.isGroup,
    props: own.props,
    detailsLayout: own.detailsLayout,
    layers: own.layers,
    prompt: own.prompt,
    workflowPrompt: own.workflowPrompt,
    workflowMode: own.workflowMode,
    metricGroups: own.metricGroups,
    metricGroupsMode: own.metricGroupsMode,
  };
}

/**
 * Индекс поверх собранного индекса прототипа: `extends` объектов (решения 0003 и 0004).
 * Промптовые поля складываются, а не подменяются — решение 0018: объект, дописавший себе
 * строчку, иначе молча потерял бы общее правило карты. Вкладки раздаются прототипом, как этапы
 * (решение 0025).
 */
export function inheritIndex(own: OwnIndex, prototype: IndexPart | undefined): IndexPart {
  const base = aloneIndex(own);
  if (!prototype) return base;

  const merged = mergeIndex(
    {
      name: prototype.name,
      props: prototype.props,
      "details-metrics-layout": prototype.detailsLayout,
    },
    {
      name: own.name,
      props: own.props,
      "details-metrics-layout": own.detailsLayout,
    },
  );

  return {
    ...base,
    prototypeName: prototype.name,
    props: merged.props ?? {},
    detailsLayout: merged["details-metrics-layout"],
    // `_index.json` прототипа — следующий слой объекта, ровно как `extends` у метрики.
    layers: [...own.layers, ...fromPrototype(prototype.layers)],
    prompt: joinPrompts(prototype.prompt, own.prompt),
    workflowPrompt: joinPrompts(prototype.workflowPrompt, own.workflowPrompt),
    metricGroups:
      own.metricGroupsMode === "replace"
        ? own.metricGroups
        : byGroup(prototype.metricGroups, own.metricGroups),
  };
}

/** Где объект и кто его прототип — всё, что нужно спискам, чтобы унаследоваться. */
type Owner = { address: string; path: string };

/** Metrics of the prototype come along; a metric of the same key overrides its parent. */
export function inheritMetrics(
  object: Owner,
  own: MapMetric[],
  prototype: { address: string; metrics: MapMetric[] } | undefined,
): MapMetric[] {
  if (!prototype) return own;
  const mine = new Map(own.map((metric) => [metric.key, metric]));
  return [
    ...prototype.metrics.map((metric) => {
      const found = mine.get(metric.key);
      // Свой `config.json` есть — метрика заведена здесь, даже если часть полей от прототипа.
      // Нет — метрика чужая, и это видно по владельцу, как у директив с экшонами.
      return found
        ? {
            ...found,
            config: mergeMetric(metric.config, found.config),
            layers: [...found.layers, ...fromPrototype(metric.layers)],
          }
        : { ...adoptMetric(object, metric), owner: metric.owner ?? prototype.address };
    }),
    ...own.filter((metric) => !prototype.metrics.some((p) => p.key === metric.key)),
  ];
}

/** Экшоны — как метрики: свой с тем же ключом перекрывает прототипов (решение 0038). */
export function inheritActions(
  object: Owner,
  own: MapAction[],
  prototype: { address: string; actions: MapAction[] } | undefined,
): MapAction[] {
  if (!prototype) return own;
  const mine = new Map(own.map((action) => [action.key, action]));
  return [
    ...prototype.actions.map((action) => {
      const found = mine.get(action.key);
      return found
        ? {
            ...found,
            config: mergeAction(action.config, found.config),
            layers: [...found.layers, ...fromPrototype(action.layers)],
          }
        : { ...adoptAction(object, action), owner: action.owner ?? prototype.address };
    }),
    ...own.filter((action) => !prototype.actions.some((p) => p.key === action.key)),
  ];
}

/**
 * По имени, и своё выигрывает: иначе одна и та же директива приезжала бы столько раз, сколько
 * прототипов в цепочке.
 */
export const inheritDirectives = (
  own: MapFile[],
  prototype: { address: string; directives: MapFile[] } | undefined,
): MapFile[] => (prototype ? byName(prototype.directives, own, prototype.address) : own);

/**
 * Этапы наследуются, как экшоны, но объект может сказать `mode: "replace"` — тогда
 * унаследованные не приезжают вовсе. Решение 0017: переопределять можно целиком и частями.
 */
export const inheritWorkflow = (
  own: MapStage[],
  mode: "merge" | "replace" | undefined,
  prototype: { address: string; workflow: MapStage[] } | undefined,
): MapStage[] =>
  !prototype || mode === "replace" ? own : byStage(prototype.workflow, own, prototype.address);

/** Где искать цели подстановок: собранные объекты по адресу, до своих подстановок. */
export type Lookup = (address: string) => Named | undefined;

/**
 * Substitution runs after inheritance, so `~` means the concrete object rather than the
 * prototype it borrowed the expression from — decision 0006.
 */
export function resolver(find: Lookup, self: Named, basePath: string, depth = 0): Resolve {
  return (raw: string): string | undefined => {
    const address = parseAddress(raw);
    if (!address || depth > 10) return undefined;

    if (address.scope === "base") return [basePath, ...address.path].join("/");

    const target =
      address.scope === "self"
        ? address.path.length === 0
          ? self
          : find(address.path.reduce(childAddress, self.address))
        : find(mapAddress(address.path));

    if (!target) return undefined;
    // Without a hash an address gives an absolute file path — decision 0005.
    if (!address.field) return target.path;

    const value = readField({ name: target.name, props: target.props }, address.field);
    if (value === undefined) return undefined;
    // A prop may itself be an expression: resolve it before handing it on.
    return typeof value === "string"
      ? substituteDeep(value, resolver(find, target, basePath, depth + 1))
      : String(value);
  };
}

/**
 * Индекс с подстановками. Промпт пишет путь адресом, а не вручную: карта переезжает, и зашитый
 * путь переезжает не с ней. Описание вкладки — такой же текст карты, как промпт.
 */
export const resolveIndex = (index: IndexPart, at: Resolve): IndexPart => ({
  ...index,
  props: substituteDeep(index.props, at),
  prompt: substituteDeep(index.prompt, at),
  workflowPrompt: substituteDeep(index.workflowPrompt, at),
  metricGroups: substituteDeep(index.metricGroups, at),
});

/** Конфиги метрик с подстановками: общая метрика берёт пути и имена у объекта. */
export const resolveMetrics = (metrics: MapMetric[], at: Resolve): MapMetric[] =>
  metrics.map((metric) => ({ ...metric, config: substituteDeep(metric.config, at) }));

/** У экшона тоже: общий экшон берёт пути и имена у объекта, на котором его нажали. */
export const resolveActions = (actions: MapAction[], at: Resolve): MapAction[] =>
  actions.map((action) => ({ ...action, config: substituteDeep(action.config, at) }));

/**
 * Объект, у которого своих этапов нет ни где, ни у прототипов, работает по дефолту — и дефолт
 * кладётся прямо в модель. Иначе его подставлял бы каждый, кто читает карту, и клиент с агентом
 * однажды показали бы разное (решение 0017).
 */
export const resolveWorkflow = (workflow: MapStage[]): MapStage[] =>
  workflow.length === 0 ? defaultStages() : workflow;
