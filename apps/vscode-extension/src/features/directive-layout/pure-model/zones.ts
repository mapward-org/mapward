/**
 * Раскладка окна под директивы: центр — обычные файлы, справа сверху — директивы, справа снизу —
 * их терминалы. Здесь только решение, какая группа какой зоной служит; вызовы редактора — в
 * адаптере.
 *
 * Зона узнаётся по содержимому группы, а не по номеру колонки: номер VS Code пересчитывает, как
 * только группу добавили, разрезали или закрыли, и запомненная «вторая колонка» начинает указывать
 * на чужую группу. Запомненный номер — только подсказка, чтобы из двух подходящих выбрать прежнюю,
 * и опора для пустой группы, которую не по чему узнать.
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

const empty = (group: GroupView) => !group.directives && !group.terminals && !group.others;

/** Из подходящих — запомненная, иначе самая правая. */
const pick = (candidates: GroupView[], remembered?: number): number | undefined =>
  (candidates.find((group) => group.column === remembered) ?? candidates.at(-1))?.column;

/**
 * Группа директив. Сначала та, где лежат только директивы, — так выглядит зона, кто бы её ни
 * завёл и куда бы ни передвинул, хоть в первую колонку. Потом группа с директивами вперемешку,
 * кроме первой: директива, открытая в центре, — гостья, а не повод считать центр зоной. Потом
 * запомненная, если она пуста. Одна группа на всё окно зоной не бывает.
 */
export function directiveZone(groups: GroupView[], remembered?: number): number | undefined {
  if (groups.length < 2) return undefined;
  const withDirectives = groups.filter((group) => group.directives);
  return (
    pick(
      withDirectives.filter((group) => !group.terminals && !group.others),
      remembered,
    ) ??
    pick(
      withDirectives.filter((group) => group.column !== 1),
      remembered,
    ) ??
    groups.find((group) => group.column === remembered && group.column !== 1 && empty(group))
      ?.column
  );
}

/**
 * Группа терминалов директив — не группа директив. Так же: сначала та, где только терминалы,
 * потом с терминалами вперемешку, кроме первой, потом запомненная пустая.
 */
export function terminalZone(
  groups: GroupView[],
  directives: number | undefined,
  remembered?: number,
): number | undefined {
  const sides = groups.filter((group) => group.column !== directives);
  const withTerminals = sides.filter((group) => group.terminals);
  return (
    pick(
      withTerminals.filter((group) => !group.directives && !group.others),
      remembered,
    ) ??
    pick(
      withTerminals.filter((group) => group.column !== 1),
      remembered,
    ) ??
    sides.find((group) => group.column === remembered && group.column !== 1 && empty(group))?.column
  );
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
