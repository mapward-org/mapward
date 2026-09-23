import type { GitLetter } from "@mapward/core";
import { strongest } from "./git.ts";

/**
 * Тело встроенного шага `git-status` — решение 0023: пометка ставится на узлы данных дисплея,
 * какой бы коллектор их ни отдал.
 *
 * Чистая функция: вход — данные предыдущего шага и справочник, выхода в среду нет. Всё, что
 * знает про команды, вотчеры и часы, живёт в службе рядом.
 */

type Node = {
  link?: unknown;
  isDir?: unknown;
  children?: unknown;
  git?: GitLetter;
  [key: string]: unknown;
};

/** `mapward://` и `https://` ведут не на файл; всё остальное — путь в проекте (решение 0004). */
const isFileLink = (link: unknown): link is string =>
  typeof link === "string" && link.length > 0 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(link);

const nodesOf = (value: unknown): Node[] =>
  Array.isArray(value) ? value.filter((item): item is Node => isNode(item)) : [];

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null;

/** Где у формы дисплея лежат узлы: дерево, список, одиночная ссылка, карта детей. */
function branches(data: Node): { key: string; nodes: Node[] }[] {
  const found: { key: string; nodes: Node[] }[] = [];
  for (const key of ["children", "items", "nodes"]) {
    const nodes = nodesOf(data[key]);
    if (nodes.length > 0) found.push({ key, nodes });
  }
  return found;
}

/** Пути всех файловых узлов: по ним служба поймёт, какие репозитории спрашивать. */
export function fileLinks(data: unknown): string[] {
  const out: string[] = [];

  const walk = (node: Node) => {
    if (isFileLink(node.link)) out.push(node.link);
    for (const { nodes } of branches(node)) for (const child of nodes) walk(child);
  };

  if (isNode(data)) walk(data as Node);
  return out;
}

/**
 * Пометки на узлах. Папка получает сильнейшую пометку потомков — иначе свёрнутое дерево прячет
 * изменение, ради которого на него и смотрят; буквы у папки нет, её не рисует клиент.
 */
export function markGit(data: unknown, letterOf: (path: string) => GitLetter | undefined): unknown {
  if (!isNode(data)) return data;

  const walk = (node: Node, root: boolean): { node: Node; letter?: GitLetter } => {
    const marked: Node = { ...node };
    const letters: GitLetter[] = [];

    for (const { key, nodes } of branches(node)) {
      marked[key] = nodes.map((child) => {
        const result = walk(child, false);
        if (result.letter) letters.push(result.letter);
        return result.node;
      });
    }

    // У папки с раскрытыми детьми пометка считается по ним, а не по справочнику: дерево
    // показывает отобранное `exclude`, и агрегат по всему каталогу говорил бы о скрытом.
    const folder = node.isDir === true || letters.length > 0;
    const own = !folder && isFileLink(node.link) ? letterOf(node.link) : undefined;
    const letter = own ?? strongest(letters);

    // Верхний уровень бывает обёрткой формы (`{ children }`, `{ items }`), а бывает самим узлом —
    // так у дисплея `link`. Отличает их собственная ссылка: у обёртки её нет, и вешать пометку
    // там не на что.
    if (letter && (!root || isFileLink(node.link))) marked.git = letter;
    else delete marked.git;

    return { node: marked, ...(letter ? { letter } : {}) };
  };

  return walk(data as Node, true).node;
}
