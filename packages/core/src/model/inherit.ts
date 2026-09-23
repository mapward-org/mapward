import { childAddress, mapAddress, parseAddress, readField } from "./address.ts";
import { defaultStages } from "./default-workflow.ts";
import { mergeAction, mergeIndex, mergeMetric } from "./merge.ts";
import { adoptAction, adoptMetric, fromPrototype } from "./model.ts";
import type { MapFile, MapObject, MapStage } from "./model.ts";
import type { OwnObject } from "./raw-object.ts";
import type { MetricGroup } from "./schema.ts";
import { substituteDeep, type Resolve } from "./substitution.ts";

/**
 * Сборка объекта из своего и прототипова — чистые функции (решение 0041). Живая модель зовёт их
 * на каждом объекте отдельно: объект собирается из своих файлов и из уже собранного прототипа,
 * а подстановки — из собранных объектов, на которые они ссылаются. Поэтому здесь один шаг, а не
 * обход дерева: дерево обходит модель.
 */

/** Объект после наследования, до подстановок: без детей — детей держит модель. */
export type Inherited = Omit<MapObject, "children">;

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

/** Объект без прототипа — ровно то, что он написал сам. */
function alone(own: OwnObject): Inherited {
  return {
    address: own.address,
    path: own.path,
    name: own.name,
    isGroup: own.isGroup,
    props: own.props,
    previewSize: own.previewSize,
    previewLayout: own.previewLayout,
    detailsLayout: own.detailsLayout,
    previewStyle: own.previewStyle,
    layers: own.layers,
    metrics: own.metrics,
    directives: own.directives,
    actions: own.actions,
    workflow: own.workflow,
    prompt: own.prompt,
    workflowPrompt: own.workflowPrompt,
    workflowMode: own.workflowMode,
    metricGroups: own.metricGroups,
    metricGroupsMode: own.metricGroupsMode,
  };
}

/**
 * Объект поверх собранного прототипа: `extends` объектов (решения 0003 и 0004). Прототипа нет —
 * объект как написан.
 */
export function inherit(own: OwnObject, prototype: Inherited | undefined): Inherited {
  const base = alone(own);
  if (!prototype) return base;

  const merged = mergeIndex(
    {
      name: prototype.name,
      props: prototype.props,
      "preview-size": prototype.previewSize,
      "preview-metrics-layout": prototype.previewLayout,
      "details-metrics-layout": prototype.detailsLayout,
      "preview-style": prototype.previewStyle,
    },
    {
      name: own.name,
      props: own.props,
      "preview-size": own.previewSize,
      "preview-metrics-layout": own.previewLayout,
      "details-metrics-layout": own.detailsLayout,
      "preview-style": own.previewStyle,
    },
  );

  // Metrics of the prototype come along; a metric of the same key overrides its parent.
  const mineMetrics = new Map(own.metrics.map((metric) => [metric.key, metric]));
  const metrics = [
    ...prototype.metrics.map((metric) => {
      const mine = mineMetrics.get(metric.key);
      // Свой `config.json` есть — метрика заведена здесь, даже если часть полей от прототипа.
      // Нет — метрика чужая, и это видно по владельцу, как у директив с экшонами.
      return mine
        ? {
            ...mine,
            config: mergeMetric(metric.config, mine.config),
            layers: [...mine.layers, ...fromPrototype(metric.layers)],
          }
        : { ...adoptMetric(own, metric), owner: metric.owner ?? prototype.address };
    }),
    ...own.metrics.filter((metric) => !prototype.metrics.some((p) => p.key === metric.key)),
  ];

  // Экшоны — как метрики: свой с тем же ключом перекрывает прототипов (решение 0038).
  const mineActions = new Map(own.actions.map((action) => [action.key, action]));
  const actions = [
    ...prototype.actions.map((action) => {
      const mine = mineActions.get(action.key);
      return mine
        ? {
            ...mine,
            config: mergeAction(action.config, mine.config),
            layers: [...mine.layers, ...fromPrototype(action.layers)],
          }
        : { ...adoptAction(own, action), owner: action.owner ?? prototype.address };
    }),
    ...own.actions.filter((action) => !prototype.actions.some((p) => p.key === action.key)),
  ];

  return {
    ...base,
    prototypeName: prototype.name,
    props: merged.props ?? {},
    previewSize: merged["preview-size"],
    previewLayout: merged["preview-metrics-layout"],
    detailsLayout: merged["details-metrics-layout"],
    previewStyle: merged["preview-style"],
    // `_index.json` прототипа — следующий слой объекта, ровно как `extends` у метрики.
    layers: [...own.layers, ...fromPrototype(prototype.layers)],
    metrics,
    // По имени, и своё выигрывает: иначе одна и та же директива приезжала бы столько раз,
    // сколько прототипов в цепочке.
    directives: byName(prototype.directives, own.directives, prototype.address),
    actions,
    // Промптовые поля складываются, а не подменяются — решение 0018: объект, дописавший себе
    // строчку, иначе молча потерял бы общее правило карты.
    prompt: joinPrompts(prototype.prompt, own.prompt),
    workflowPrompt: joinPrompts(prototype.workflowPrompt, own.workflowPrompt),
    // Этапы наследуются, как экшоны, но объект может сказать `mode: "replace"` — тогда
    // унаследованные не приезжают вовсе. Решение 0017.
    workflow:
      own.workflowMode === "replace"
        ? own.workflow
        : byStage(prototype.workflow, own.workflow, prototype.address),
    // Вкладки раздаются прототипом так же, как этапы (решение 0025).
    metricGroups:
      own.metricGroupsMode === "replace"
        ? own.metricGroups
        : byGroup(prototype.metricGroups, own.metricGroups),
  };
}

/** Где искать цели подстановок: собранные объекты по адресу, до своих подстановок. */
export type Lookup = (address: string) => Inherited | undefined;

/**
 * Substitution runs after inheritance, so `~` means the concrete object rather than the
 * prototype it borrowed the expression from — decision 0006.
 */
export function resolver(find: Lookup, self: Inherited, basePath: string, depth = 0): Resolve {
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
 * Объект с подстановками и дефолтными этапами — то, что видят сайдбар и агент.
 *
 * Объект, у которого своих этапов нет ни где, ни у прототипов, работает по дефолту — и дефолт
 * кладётся прямо в модель. Иначе его подставлял бы каждый, кто читает карту, и клиент с агентом
 * однажды показали бы разное (решение 0017).
 */
export function resolve(object: Inherited, find: Lookup, basePath: string): Inherited {
  const at = resolver(find, object, basePath);
  return {
    ...object,
    props: substituteDeep(object.props, at),
    // Промпт пишет путь адресом, а не вручную: карта переезжает, и зашитый путь переезжает не с
    // ней. Подстановка идёт после наследования, поэтому `~` значит объект, а не прототип.
    prompt: substituteDeep(object.prompt, at),
    workflowPrompt: substituteDeep(object.workflowPrompt, at),
    metrics: object.metrics.map((metric) => ({
      ...metric,
      config: substituteDeep(metric.config, at),
    })),
    // У экшона тоже: общий экшон берёт пути и имена у объекта, на котором его нажали.
    actions: object.actions.map((action) => ({
      ...action,
      config: substituteDeep(action.config, at),
    })),
    // Описание вкладки — такой же текст карты, как промпт: в нём пишут пути адресами.
    metricGroups: substituteDeep(object.metricGroups, at),
    workflow: object.workflow.length === 0 ? defaultStages() : object.workflow,
  };
}
