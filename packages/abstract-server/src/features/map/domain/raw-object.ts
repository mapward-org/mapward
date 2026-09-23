import { Check } from "typebox/value";
import { ActionConfig, childAddress, MetricConfig, ObjectIndex } from "@mapward/core";
import type {
  ConfigLayer,
  MapAction,
  MapFile,
  MapMetric,
  MapObject,
  MapStage,
  MetricGroup,
} from "@mapward/core";
import type { FileEntry } from "../../../ports/index.ts";
import { join } from "../../../lib/path.ts";
import { flag, frontmatter } from "../../../lib/frontmatter.ts";
import { anchorDisplay } from "./anchor-display.ts";

/**
 * Объект карты так, как он написан на диске, — до наследования и подстановок. Каждая функция
 * здесь получает уже прочитанное: читает файлы реактивная модель (решение 0041).
 */

export const INDEX = "_index.json";
export const METRICS = "_metrics";
export const DIRECTIVES = "_directives";
export const ACTIONS = "_actions";
export const WORKFLOW = "_directives.workflow";
export const CONFIG = "config.json";

/**
 * Служебное начинается с `_` — решение 0002. Остальное в папке карты это её содержимое.
 * Скрытое, с точки, — тоже не объект: там лежат локальные прогоны карты (решение 0038).
 */
export const isService = (name: string) => name.startsWith("_") || name.startsWith(".");

export type Raw = MapObject & {
  rawExtends?: string;
  // Промптовые поля склеиваются, а не подменяются, поэтому своё приходится помнить отдельно:
  // прототип наследуется не один раз, и склейка поверх уже склеенного удвоила бы общее.
  rawPrompt?: string;
  rawWorkflowPrompt?: string;
  // По той же причине — слои и метрики: они не подменяются, а дописываются прототиповыми,
  // и считать надо от своего, а не от того, что уже получилось.
  rawLayers: ConfigLayer[];
  rawMetrics: MapMetric[];
  rawActions: MapAction[];
  rawMetricGroups: MetricGroup[];
};

/** Файлы папки, без подпапок. */
export function filesOf(dir: string, entries: FileEntry[]): MapFile[] {
  return entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      name: entry.name,
      path: join(dir, entry.name),
      // Хост, который размера не назвал, оставляет поле пустым: это «не знаю», а не ноль.
      ...(entry.size === undefined ? {} : { bytes: entry.size }),
    }));
}

/** Git may store either ending; a directive that only changed line endings has not changed. */
const norm = (value: string | undefined) => value?.replaceAll("\r\n", "\n");

/**
 * A directive knows three states, and all three come from comparing its text with the copy
 * the run left behind: no copy means new, a different copy means changed — decision 0002.
 * Текст самой директивы нужен, только когда состояние есть: `text` тогда и читается.
 */
export function directiveStatus(
  file: MapFile,
  state: string | undefined,
  text: string | undefined,
): MapFile {
  if (!state) return { ...file, status: "new" };
  try {
    const saved = JSON.parse(state) as {
      directive?: string;
      run?: { stage: string; startedAt: string; finishedAt?: string };
      runs?: Record<string, number>;
    };
    const run = saved.run;
    // Сколько кругов директива прошла. Состояние старого формата счётчика не несёт —
    // тогда его и нет: приписывать единицу значило бы выдумать историю.
    const runs = saved.runs;
    const seen = { ...file, run, ...(runs === undefined ? {} : { runs }) };
    // Этап, который не помечает выполнение, копии не снимает: прогон был, а директива
    // по-прежнему не сделана — решение 0017. Без копии сравнивать не с чем.
    if (saved.directive === undefined) return { ...seen, status: "new" };
    const same = norm(saved.directive) === norm(text);
    return { ...seen, status: same ? "done" : "changed" };
  } catch {
    return { ...file, status: "new" };
  }
}

/**
 * Этап воркфлоу: файл на этап, frontmatter задаёт имя, порядок и то, ставит ли этап отметку
 * о выполнении — решение 0017. Порядок читается здесь, а не из имени файла: имя смысловое,
 * его меняют, а порядок переставляют отдельно.
 */
export function stageOf(name: string, path: string, text: string | undefined): MapStage {
  const fields = text === undefined ? {} : frontmatter(text).fields;
  const order = Number(fields.order);
  return {
    name: fields.name ?? name.replace(/\.md$/, ""),
    order: Number.isFinite(order) ? order : 0,
    marksDone: flag(fields["marks-done"]),
    path,
  };
}

export const sortStages = (stages: MapStage[]): MapStage[] =>
  stages.toSorted((a, b) => a.order - b.order);

/** Своя метрика объекта, до `extends`; конфиг не читается — метрики нет. */
export function ownMetric(
  objectPath: string,
  address: string,
  key: string,
  raw: unknown,
): MapMetric | undefined {
  if (raw === undefined) return undefined;
  const dir = join(objectPath, METRICS, key);
  const configPath = join(dir, CONFIG);
  const own = `${childAddress(address, METRICS)}/${key}`;
  return {
    key,
    address: own,
    configPath,
    cachePath: dir,
    // Первый слой — тот файл, с которого мердж начинается; остальные припишет `extends`.
    layers: [{ address: own, path: configPath, from: "own" }],
    // Пути компонента — от этого файла, пока слой ещё виден (решение 0037).
    config: Check(MetricConfig, raw) ? anchorDisplay(raw, configPath) : {},
  };
}

/**
 * Экшоны — решение 0038: папки в `_actions/` с `config.json`, как метрики. Markdown в `_actions/`
 * больше не читается: инструкция для агента — это дока, а не экшон.
 */
export function ownAction(
  objectPath: string,
  address: string,
  key: string,
  raw: unknown,
): MapAction | undefined {
  if (raw === undefined) return undefined;
  const configPath = join(objectPath, ACTIONS, key, CONFIG);
  const own = `${childAddress(address, ACTIONS)}/${key}`;
  return {
    key,
    address: own,
    configPath,
    layers: [{ address: own, path: configPath, from: "own" }],
    config: Check(ActionConfig, raw) ? raw : {},
  };
}

/** Всё, что прочитано про один объект. */
export type ObjectParts = {
  path: string;
  address: string;
  /** Имя папки: им объект зовётся, если своего имени не написал. */
  folder: string;
  /** `_index.json` как есть; у группы его нет вовсе. */
  index: unknown;
  metrics: MapMetric[];
  actions: MapAction[];
  directives: MapFile[];
  workflow: MapStage[];
  children: Raw[];
};

/**
 * Reads the tree as written on disk. Inheritance and substitution come after — they need the
 * whole map to look things up in.
 */
export function rawObject(parts: ObjectParts): Raw {
  const { path, address, index, metrics, actions } = parts;
  const own: ObjectIndex = Check(ObjectIndex, index) ? index : {};
  // У группы `_index.json` нет вовсе, и слоя тоже нет: показывать нечего, а пустой путь
  // выглядел бы файлом, которого не существует.
  const layers: ConfigLayer[] =
    index === undefined ? [] : [{ address, path: join(path, INDEX), from: "own" }];

  return {
    address,
    path,
    name: own.name ?? parts.folder,
    isGroup: index === undefined,
    props: own.props ?? {},
    previewSize: own["preview-size"],
    previewLayout: own["preview-metrics-layout"],
    detailsLayout: own["details-metrics-layout"],
    previewStyle: own["preview-style"],
    layers,
    metrics,
    directives: parts.directives,
    actions,
    workflow: parts.workflow,
    prompt: own.prompt,
    workflowPrompt: own["directives-workflow"]?.prompt,
    workflowMode: own["directives-workflow"]?.mode,
    metricGroups: own["metric-groups"]?.groups ?? [],
    metricGroupsMode: own["metric-groups"]?.mode,
    children: parts.children,
    rawPrompt: own.prompt,
    rawWorkflowPrompt: own["directives-workflow"]?.prompt,
    rawExtends: own.extends,
    rawLayers: layers,
    rawMetrics: metrics,
    rawActions: actions,
    rawMetricGroups: own["metric-groups"]?.groups ?? [],
  } as Raw;
}
