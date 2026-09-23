/**
 * Раскрытие папок в деревьях метрики. Запоминается у человека, как свёрнутость метрик: по
 * деревьям внутри метрики — у `FileTree` набора бывает `id`, — а в дереве списком путей папок.
 */
export type OpenFolders = Record<string, string[]>;

/** Встроенное дерево и дерево набора без `id` — одно и то же: сменил дисплей — раскрытие осталось. */
export const DEFAULT_TREE = "";

/** Что строке дерева нужно знать о раскрытии и как о нём сообщить. */
export type TreeOpen = {
  /** Сохранённое ещё не пришло — дерево не рисуется, чтобы не мигать закрытым. */
  ready: boolean;
  isOpen: (path: string) => boolean;
  toggle: (path: string) => void;
};

/**
 * Папка узнаётся цепочкой имён от корня, а не номером строки: пересчёт метрики добавляет файлы, и
 * номера съезжают. Без имени — номер, как у ключа строки.
 */
export const folderPath = (parent: string, label: string | undefined, index: number) => {
  const name = label ?? `#${index}`;
  return parent === "" ? name : `${parent}/${name}`;
};

export const isFolderOpen = (state: OpenFolders, tree: string, path: string) =>
  state[tree]?.includes(path) ?? false;

/** Исчезнувшие папки не вычищаются: лишние строки в памяти редактора вреда не делают. */
export const toggleFolder = (state: OpenFolders, tree: string, path: string): OpenFolders => {
  const open = state[tree] ?? [];
  return {
    ...state,
    [tree]: open.includes(path) ? open.filter((p) => p !== path) : [...open, path],
  };
};

/** Раскрытие одного дерева поверх состояния метрики. */
export const treeOpen = (
  state: OpenFolders,
  ready: boolean,
  tree: string,
  save: (next: OpenFolders) => void,
): TreeOpen => ({
  ready,
  isOpen: (path) => isFolderOpen(state, tree, path),
  toggle: (path) => save(toggleFolder(state, tree, path)),
});
