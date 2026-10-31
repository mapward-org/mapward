/**
 * Раскладка окна под директивы: центр — обычные файлы, справа сверху — директивы, справа снизу —
 * их терминалы. Здесь только решение, какая группа какой зоной служит; вызовы редактора — в
 * адаптере.
 */

/** Файл директивы — markdown прямо в папке `_directives` объекта. */
export function isDirectivePath(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/");
  return segments.length >= 2 && segments.at(-2) === "_directives" && /\.md$/i.test(path);
}

/** Группа редактора глазами раскладки: номер колонки и что в ней лежит. */
export type GroupView = { column: number; directives: boolean; terminals: boolean };

/**
 * Группа директив: запомненная, если она ещё есть и это не центр; иначе самая правая из тех,
 * где лежат директивы, кроме центра. Центр — первая группа: туда открываются обычные файлы,
 * и директива, попавшая туда, — гостья, а не повод считать центр зоной директив.
 */
export function directiveZone(groups: GroupView[], remembered?: number): number | undefined {
  const sides = groups.filter((group) => group.column !== 1);
  if (remembered !== undefined && sides.some((group) => group.column === remembered)) {
    return remembered;
  }
  return sides.filter((group) => group.directives).at(-1)?.column;
}

/**
 * Группа терминалов директив: запомненная или та, где лежат терминалы, — не центр и не группа
 * директив.
 */
export function terminalZone(
  groups: GroupView[],
  directives: number | undefined,
  remembered?: number,
): number | undefined {
  const sides = groups.filter((group) => group.column !== 1 && group.column !== directives);
  if (remembered !== undefined && sides.some((group) => group.column === remembered)) {
    return remembered;
  }
  return sides.filter((group) => group.terminals).at(-1)?.column;
}
