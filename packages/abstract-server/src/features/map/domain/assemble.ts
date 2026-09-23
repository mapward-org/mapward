import {
  adoptAction,
  adoptMetric,
  childAddress,
  findObject,
  fromPrototype,
  mapAddress,
  parseAddress,
  readField,
} from "@mapward/core";
import type { MapFile, MapObject, MapStage, MetricGroup } from "@mapward/core";
import { defaultStages } from "../../../kernel/default-workflow.ts";
import { mergeAction, mergeIndex, mergeMetric } from "./merge.ts";
import type { Raw } from "./raw-object.ts";
import { substituteDeep } from "./substitution.ts";

/**
 * Сборка карты из прочитанного: наследование, подстановки, дефолтные этапы. Чистые функции —
 * их зовёт реактивная модель (решение 0041), когда прочитанное изменилось; читать файлы здесь
 * нечем и незачем.
 */

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
 * тем, что объект написал сам, а не с тем, что у него уже получилось: прототип наследуется
 * столько раз, сколько у него наследников, и накопление удвоило бы общую часть.
 */
const joinPrompts = (inherited?: string, own?: string): string | undefined => {
  const parts = [inherited, own].filter((part) => part !== undefined && part !== "");
  return parts.length === 0 ? undefined : parts.join("\n\n");
};

/** `extends` resolves recursively; a cycle is an error, not a hang. */
function inherit(root: Raw, object: Raw, seen: Set<string> = new Set()): void {
  for (const child of object.children as Raw[]) inherit(root, child, new Set());

  const address = object.rawExtends;
  if (!address || seen.has(object.address)) return;
  seen.add(object.address);

  const prototype = findObject(root, address) as Raw | undefined;
  if (!prototype) return;
  inherit(root, prototype, seen);

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
      name: object.name,
      props: object.props,
      "preview-size": object.previewSize,
      "preview-metrics-layout": object.previewLayout,
      "details-metrics-layout": object.detailsLayout,
      "preview-style": object.previewStyle,
    },
  );

  object.prototypeName = prototype.name;
  object.props = merged.props ?? {};
  object.previewSize = merged["preview-size"];
  object.previewLayout = merged["preview-metrics-layout"];
  object.detailsLayout = merged["details-metrics-layout"];
  object.previewStyle = merged["preview-style"];

  // `_index.json` прототипа — следующий слой объекта, ровно как `extends` у метрики.
  object.layers = [...object.rawLayers, ...fromPrototype(prototype.layers)];

  // Metrics of the prototype come along; a metric of the same key overrides its parent.
  const own = new Map(object.rawMetrics.map((metric) => [metric.key, metric]));
  object.metrics = [
    ...prototype.metrics.map((metric) => {
      const mine = own.get(metric.key);
      // Свой `config.json` есть — метрика заведена здесь, даже если часть полей от прототипа.
      // Нет — метрика чужая, и это видно по владельцу, как у директив с экшонами.
      return mine
        ? {
            ...mine,
            config: mergeMetric(metric.config, mine.config),
            layers: [...mine.layers, ...fromPrototype(metric.layers)],
          }
        : { ...adoptMetric(object, metric), owner: metric.owner ?? prototype.address };
    }),
    ...object.rawMetrics.filter((metric) => !prototype.metrics.some((p) => p.key === metric.key)),
  ];
  // По имени, и своё выигрывает: прототип достаётся нескольким наследникам, и без дедупа
  // одна и та же директива приезжает столько раз, сколько их в цепочке.
  object.directives = byName(prototype.directives, object.directives, prototype.address);
  // Экшоны — как метрики: свой с тем же ключом перекрывает прототипов (решение 0038).
  const ownActions = new Map(object.rawActions.map((action) => [action.key, action]));
  object.actions = [
    ...prototype.actions.map((action) => {
      const mine = ownActions.get(action.key);
      return mine
        ? {
            ...mine,
            config: mergeAction(action.config, mine.config),
            layers: [...mine.layers, ...fromPrototype(action.layers)],
          }
        : { ...adoptAction(object, action), owner: action.owner ?? prototype.address };
    }),
    ...object.rawActions.filter((action) => !prototype.actions.some((p) => p.key === action.key)),
  ];
  // Промптовые поля складываются, а не подменяются — решение 0018: объект, дописавший себе
  // строчку, иначе молча потерял бы общее правило карты. Через `mergeIndex` они не ходят: там
  // заявленным считается присутствие ключа, а склейка — не мердж.
  object.prompt = joinPrompts(prototype.prompt, object.rawPrompt);
  object.workflowPrompt = joinPrompts(prototype.workflowPrompt, object.rawWorkflowPrompt);
  // Этапы наследуются, как экшоны, но объект может сказать `mode: "replace"` — тогда
  // унаследованные не приезжают вовсе. Решение 0017: переопределять можно целиком и частями.
  object.workflow =
    object.workflowMode === "replace"
      ? object.workflow
      : byStage(prototype.workflow, object.workflow, prototype.address);
  // Вкладки раздаются прототипом так же, как этапы: набор метрик — свойство вида объектов,
  // а не одного объекта. Считается от своих групп, а не от уже получившихся: прототип
  // наследуется многими, и накопление удвоило бы его вкладки (решение 0025).
  object.metricGroups =
    object.metricGroupsMode === "replace"
      ? object.rawMetricGroups
      : byGroup(prototype.metricGroups, object.rawMetricGroups);
}

/**
 * Substitution runs after inheritance, so `~` means the concrete object rather than the
 * prototype it borrowed the expression from — decision 0006.
 */
function resolver(root: MapObject, self: MapObject, basePath: string, depth = 0) {
  return (raw: string): string | undefined => {
    const address = parseAddress(raw);
    if (!address || depth > 10) return undefined;

    if (address.scope === "base") return [basePath, ...address.path].join("/");

    const target =
      address.scope === "self"
        ? address.path.length === 0
          ? self
          : findObject(root, address.path.reduce(childAddress, self.address))
        : findObject(root, mapAddress(address.path));

    if (!target) return undefined;
    // Without a hash an address gives an absolute file path — decision 0005.
    if (!address.field) return target.path;

    const value = readField({ name: target.name, props: target.props }, address.field);
    if (value === undefined) return undefined;
    // A prop may itself be an expression: resolve it before handing it on.
    return typeof value === "string"
      ? substituteDeep(value, resolver(root, target, basePath, depth + 1))
      : String(value);
  };
}

function apply(root: MapObject, object: MapObject, basePath: string): void {
  const resolve = resolver(root, object, basePath);
  object.props = substituteDeep(object.props, resolve);
  // Промпт пишет путь адресом, а не вручную: карта переезжает, и зашитый путь переезжает не с
  // ней. Подстановка идёт после наследования, поэтому `~` значит объект, а не прототип.
  object.prompt = substituteDeep(object.prompt, resolve);
  object.workflowPrompt = substituteDeep(object.workflowPrompt, resolve);
  object.metrics = object.metrics.map((metric) => ({
    ...metric,
    config: substituteDeep(metric.config, resolve),
  }));
  // У экшона тоже: общий экшон берёт пути и имена у объекта, на котором его нажали.
  object.actions = object.actions.map((action) => ({
    ...action,
    config: substituteDeep(action.config, resolve),
  }));
  // Описание вкладки — такой же текст карты, как промпт: в нём пишут пути адресами.
  object.metricGroups = substituteDeep(object.metricGroups, resolve);
  for (const child of object.children) apply(root, child, basePath);
}

/**
 * Объект, у которого своих этапов нет ни где, ни у прототипов, работает по дефолту — и дефолт
 * кладётся прямо в модель. Иначе его подставлял бы каждый, кто читает карту, и клиент с агентом
 * однажды показали бы разное (решение 0017).
 */
function fillWorkflow(object: MapObject): void {
  if (object.workflow.length === 0) object.workflow = defaultStages();
  for (const child of object.children) fillWorkflow(child);
}

/**
 * Карта в том виде, в каком её рисует сайдбар. Дерево мутируется на месте, поэтому модель
 * отдаёт сюда копию прочитанного, а не его само: прочитанное живёт дальше и собирается снова.
 */
export function assemble(root: Raw, basePath: string): MapObject {
  inherit(root, root);
  fillWorkflow(root);
  apply(root, root, basePath);
  return root;
}
