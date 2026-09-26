/**
 * Куда ведёт кнопка «к объекту» из файла директивы. Вкладка, которая этот объект сейчас
 * показывает, важнее сайдбара: объект уже открыт там, где на него смотрят. Таких несколько —
 * берётся та, что была активна последней.
 *
 * Вкладка — это то, куда таб ушёл переходами, а не то, на чём его открыли: таб, ушедший на другой
 * объект, этот объект больше не показывает.
 */
export type ShownTab<T> = { tab: T; mapPath: string; address: string; activeAt: number };

export type FocusTarget<T> = { kind: "tab"; tab: T } | { kind: "sidebar" };

export function focusTarget<T>(
  tabs: Iterable<ShownTab<T>>,
  wanted: { mapPath: string; address: string },
): FocusTarget<T> {
  let best: ShownTab<T> | undefined;
  for (const shown of tabs) {
    if (shown.mapPath !== wanted.mapPath || shown.address !== wanted.address) continue;
    if (!best || shown.activeAt > best.activeAt) best = shown;
  }
  return best ? { kind: "tab", tab: best.tab } : { kind: "sidebar" };
}
