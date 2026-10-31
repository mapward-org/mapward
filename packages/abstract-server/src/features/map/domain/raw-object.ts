import { Check } from "typebox/value";
import type { FileEntry } from "@mapward/vfs";
import {
  ACTIONS,
  CONFIG,
  childAddress,
  INDEX,
  METRICS,
  type ConfigLayer,
  type MapAction,
  type MapFile,
  type MapMetric,
  type MapStage,
  type MetricGroup,
} from "@mapward/core";
import { anchorAction, anchorDisplay, anchorGroups } from "./anchor-display.ts";
import { ActionConfig, MetricConfig, ObjectIndex } from "./schema.ts";
import { join } from "../../../lib/path.ts";
import { flag, frontmatter } from "../../../lib/frontmatter.ts";

/**
 * Объект карты так, как он написан на диске, — до наследования и подстановок. Каждая функция
 * здесь получает уже прочитанное: читает файлы живая модель (решение 0041).
 */

/**
 * Служебное начинается с `_` — решение 0002. Остальное в папке карты это её содержимое.
 * Скрытое, с точки, — тоже не объект: там лежат локальные прогоны карты (решение 0038).
 */
export const isService = (name: string) => name.startsWith("_") || name.startsWith(".");

/**
 * Своё у объекта из его `_index.json`: всё, кроме списков (метрик, экшонов, директив, этапов) —
 * те читаются каждый из своей папки и своей частью (решение 0042).
 */
export type OwnIndex = {
  address: string;
  path: string;
  name: string;
  isGroup: boolean;
  /** Куда ведёт `extends` объекта — его прототип. */
  extends?: string;
  props: Record<string, unknown>;
  layers: ConfigLayer[];
  prompt?: string;
  workflowPrompt?: string;
  workflowMode?: "merge" | "replace";
  metricGroups: MetricGroup[];
  metricGroupsMode?: "merge" | "replace";
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
    // Путь плагина — от этого файла, пока слой ещё виден.
    config: Check(ActionConfig, raw) ? anchorAction(raw, configPath) : {},
  };
}

/** Индекс объекта по его `_index.json`; у группы файла нет вовсе. */
export function ownIndex(parts: {
  path: string;
  address: string;
  /** Имя папки: им объект зовётся, если своего имени не написал. */
  folder: string;
  /** `_index.json` как есть. */
  index: unknown;
}): OwnIndex {
  const { path, address, index } = parts;
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
    extends: own.extends,
    props: own.props ?? {},
    layers,
    prompt: own.prompt,
    workflowPrompt: own["directives-workflow"]?.prompt,
    workflowMode: own["directives-workflow"]?.mode,
    // Раскладка группы — от папки этого `_index.json`: после наследования её папки уже не видно.
    metricGroups: anchorGroups(own["metric-groups"]?.groups ?? [], path),
    metricGroupsMode: own["metric-groups"]?.mode,
  };
}
