/**
 * Раскладка окна под директивы: центр — обычные файлы, справа сверху — директивы, справа снизу —
 * их терминалы. Здесь только решение, какая группа какой зоной служит; вызовы редактора — в
 * адаптере.
 *
 * Группы директив и терминалов раскладка заводит сама и закрепляет: в закреплённую группу VS Code
 * чужой файл не кладёт. Поэтому своя группа узнаётся по содержимому — только директивы или только
 * терминалы. Номер колонки — лишь подсказка, какую из подходящих взять: VS Code пересчитывает его
 * при любой перестройке групп.
 */

/** Файл директивы — markdown прямо в папке `_directives` объекта. */
export function isDirectivePath(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/");
  return segments.length >= 2 && segments.at(-2) === "_directives" && /\.md$/i.test(path);
}

/**
 * Группа редактора глазами раскладки: номер колонки и что в ней лежит. `others` — вкладки, которые
 * не директивы и не терминалы: обычные файлы, карта.
 */
export type GroupView = {
  column: number;
  directives: boolean;
  terminals: boolean;
  others: boolean;
};

/** Из подходящих — запомненная, иначе самая правая. */
const pick = (candidates: GroupView[], remembered?: number): number | undefined =>
  (candidates.find((group) => group.column === remembered) ?? candidates.at(-1))?.column;

/** Группа директив — где лежат только директивы. */
export function directiveZone(groups: GroupView[], remembered?: number): number | undefined {
  return pick(
    groups.filter((group) => group.directives && !group.terminals && !group.others),
    remembered,
  );
}

/** Группа терминалов директив — где лежат только терминалы. */
export function terminalZone(groups: GroupView[], remembered?: number): number | undefined {
  return pick(
    groups.filter((group) => group.terminals && !group.directives && !group.others),
    remembered,
  );
}

/**
 * Куда завести группу директив, когда её нет: справа от всех групп. Даже одна пустая группа
 * остаётся слева центром — туда, на всю высоту окна, лягут обычные файлы.
 */
export function newDirectiveColumn(groups: GroupView[]): number {
  return Math.max(0, ...groups.map((group) => group.column)) + 1;
}

/**
 * Центр — куда открываются обычные файлы: первая группа, которая не зона директив и не зона
 * терминалов. Открытый в активной группе файл попадал в группу директив, а закреплённую VS Code
 * обходит и уводит файл к соседям — к терминалам.
 */
export function centerZone(
  groups: GroupView[],
  directives: number | undefined,
  terminals: number | undefined,
): number | undefined {
  return groups.find((group) => group.column !== directives && group.column !== terminals)?.column;
}

/**
 * Как вернуть окну раскладку: центр слева на всю высоту, директива с терминалом — правой колонкой.
 *
 * - `make-center` — центра нет, все группы заняты директивами и терминалами: завести центр слева;
 * - `arrange` — центр первым, за ним зоны (директивы раньше терминалов) и больше ничего: задать
 *   окну раскладку, VS Code раздаст группы клеткам по порядку; `right` — сколько групп справа;
 * - `extra` — кроме центра и зон есть другие группы: какую куда, раскладка не знает;
 * - `none` — зон нет, раскладывать нечего.
 */
export type LayoutPlan =
  | { kind: "make-center" }
  | { kind: "arrange"; right: number }
  | { kind: "extra"; count: number }
  | { kind: "none" };

export function layoutPlan(
  groups: GroupView[],
  directives: number | undefined,
  terminals: number | undefined,
): LayoutPlan {
  const zones = [directives, terminals].filter((column) => column !== undefined);
  if (zones.length === 0) return { kind: "none" };
  const center = centerZone(groups, directives, terminals);
  if (center === undefined) return { kind: "make-center" };
  const extra = groups.length - 1 - zones.length;
  if (extra > 0) return { kind: "extra", count: extra };
  const ordered = [center, ...zones].every((column, index) => column === index + 1);
  return ordered ? { kind: "arrange", right: zones.length } : { kind: "extra", count: 0 };
}
