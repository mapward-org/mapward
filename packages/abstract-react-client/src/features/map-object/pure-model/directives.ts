import type { MapFile } from "@mapward/core";

/** Three states, straight from decision 0002: no copy, a different copy, the same copy. */
export const statusHint = { new: "новая", changed: "изменилась", done: "выполнена" };

/**
 * `new` серым: ещё не запускавшихся директив в списке большинство, и цвет, которым помечено
 * обычное, перестаёт что-либо значить. Цвет остаётся за тем, что случилось, — решение 0028.
 */
export const statusColor = {
  new: "text-[var(--mw-descriptionForeground,#888)]",
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

/**
 * Цвет подсказки: серое — только «новая», то есть директива, которую ещё не запускали.
 * Как только у неё появился прогон, в строке стоит этап, и он синий — это уже работа,
 * а не пустое место (решение 0028).
 */
export const directiveHintClass = (file: MapFile): string =>
  runHint(file) === undefined ? statusColor[fileStatus(file)] : "text-[var(--mw-charts-blue,#4a9)]";

/** От новых к старым: имя начинается с даты, поэтому порядок с диска достаточно перевернуть. */
export const newestFirst = (files: MapFile[]): MapFile[] => files.toReversed();

/**
 * Подпись строки: имя без даты, времени и расширения — решение 0028. Дату видно порядком
 * списка, расширение одинаково у всех, а ширина строки уходит на них первой. Порядок
 * по-прежнему считается по самому имени файла: чистка касается только того, что на экране.
 */
export const directiveLabel = (file: MapFile): string =>
  file.name.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");

/** Дефисы и подчёркивания имени читаются пробелами: слово набирают так, как его видят. */
const words = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .trim();

/**
 * Фильтр списка по названию: подстрока без регистра. Ищется по имени целиком, а не только
 * по подписи: дата в имени тоже поиск — «2026-09-21» находит директивы того дня. Пустой
 * запрос ничего не отбирает.
 */
export const matchDirectives = (files: MapFile[], query: string): MapFile[] => {
  const needle = words(query);
  return needle === "" ? files : files.filter((file) => words(file.name).includes(needle));
};

/**
 * Незакрытые директивы — `new` и `changed`. Работа идёт именно с ними, поэтому они висят
 * на первом экране объекта, а выполненные остаются в списке мета-экрана (решение 0024).
 * Потолка нет: десяток незакрытых — это состояние работы, и прятать его нечестно.
 */
export const activeDirectives = (files: MapFile[]): MapFile[] =>
  newestFirst(files).filter((file) => fileStatus(file) !== "done");
