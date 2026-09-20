import type { MapFile } from "@mapward/core";

/** Three states, straight from decision 0002: no copy, a different copy, the same copy. */
export const statusHint = { new: "новая", changed: "изменилась", done: "выполнена" };

export const statusColor = {
  new: "text-[var(--mw-charts-blue,#4a9)]",
  changed: "text-[var(--mw-charts-yellow,#c93)]",
  done: "text-[var(--mw-charts-green,#3a3)]",
};

export const fileStatus = (file: MapFile) => file.status ?? "new";

/**
 * Какой этап на директиве шёл последним: отметку ставит сам прогон, а не интерфейс
 * (решение 0017).
 */
export const runHint = (file: MapFile): string | undefined =>
  file.run === undefined
    ? undefined
    : file.run.finishedAt === undefined
      ? `${file.run.stage}…`
      : file.run.stage.toLowerCase();

/** Подсказка строки: где директива сейчас, а если нигде — какая она. */
export const directiveHint = (file: MapFile): string =>
  runHint(file) ?? statusHint[fileStatus(file)];

/** От новых к старым: имя начинается с даты, поэтому порядок с диска достаточно перевернуть. */
export const newestFirst = (files: MapFile[]): MapFile[] => files.toReversed();

/**
 * Незакрытые директивы — `new` и `changed`. Работа идёт именно с ними, поэтому они висят
 * на первом экране объекта, а выполненные остаются в списке мета-экрана (решение 0024).
 * Потолка нет: десяток незакрытых — это состояние работы, и прятать его нечестно.
 */
export const activeDirectives = (files: MapFile[]): MapFile[] =>
  newestFirst(files).filter((file) => fileStatus(file) !== "done");
