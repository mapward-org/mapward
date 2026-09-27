import type { MapFile } from "@mapward/core";
import { matches } from "./search.ts";

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

/** Синий — первый круг работы: прогон был, а закрыта директива ещё не была. */
const workColor = "text-[var(--mw-charts-blue,#4a9)]";

/**
 * Идёт ли на директиве этап сейчас: отметку ставит сам прогон, а не интерфейс (решение 0017).
 * Идущий этап рисуется лоадером рядом с подписью (решение 0047).
 */
export const isRunning = (file: MapFile): boolean =>
  file.run !== undefined && file.run.finishedAt === undefined;

/**
 * Подсказка строки (решение 0047): закрытая — «выполнена», имя последнего этапа после
 * закрытия ничего не говорит; иначе этап, на котором директива сейчас, а без прогонов —
 * какая она.
 */
export const directiveHint = (file: MapFile): string =>
  fileStatus(file) === "done" || file.run === undefined
    ? statusHint[fileStatus(file)]
    : file.run.stage.toLowerCase();

/**
 * Цвет подсказки (решение 0047): статус держит свой цвет и с прогоном — закрытая зелёная,
 * изменившаяся после закрытия жёлтая. Серое — только не запускавшаяся, синее — первый круг.
 */
export const directiveHintClass = (file: MapFile): string =>
  fileStatus(file) === "new" && file.run !== undefined ? workColor : statusColor[fileStatus(file)];

/** От новых к старым: имя начинается с даты, поэтому порядок с диска достаточно перевернуть. */
export const newestFirst = (files: MapFile[]): MapFile[] => files.toReversed();

/**
 * Подпись строки: имя без даты, времени и расширения — решение 0028. Дату видно порядком
 * списка, расширение одинаково у всех, а ширина строки уходит на них первой. Порядок
 * по-прежнему считается по самому имени файла: чистка касается только того, что на экране.
 */
export const directiveLabel = (file: MapFile): string =>
  file.name.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");

/**
 * Фильтр списка по названию. Ищется по имени целиком, а не только по подписи: дата в имени
 * тоже поиск — «2026-09-21» находит директивы того дня.
 */
export const matchDirectives = (files: MapFile[], query: string): MapFile[] =>
  files.filter((file) => matches(query, file.name));

/**
 * Незакрытые директивы — `new` и `changed`. Работа идёт именно с ними, поэтому они висят
 * на первом экране объекта, а выполненные остаются в списке мета-экрана (решение 0024).
 * Потолка нет: десяток незакрытых — это состояние работы, и прятать его нечестно.
 */
export const activeDirectives = (files: MapFile[]): MapFile[] =>
  newestFirst(files).filter((file) => fileStatus(file) !== "done");
