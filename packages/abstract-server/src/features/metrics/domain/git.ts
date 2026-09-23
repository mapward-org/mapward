import type { GitLetter } from "@mapward/core";

/**
 * Перевод порцелейна в буквы узлов — решение 0023.
 *
 * Набор средний: `M A D U C`, без разделения staged и unstaged. Двух колонок `XY` у git больше,
 * чем букв здесь, поэтому пара схлопывается в одну — так, чтобы пометка читалась привычно тому,
 * кто смотрел на неё в редакторе.
 */

/** Что несёт одна колонка. Переименование и копия — это файл, которого в старом дереве не было. */
const ofColumn = (column: string): GitLetter | undefined => {
  if (column === "M" || column === "T") return "M";
  if (column === "A" || column === "R" || column === "C") return "A";
  if (column === "D") return "D";
  return undefined;
};

/** Сильнейшее из двух: пропажа заметнее появления, появление заметнее правки. */
const ORDER: GitLetter[] = ["D", "A", "M"];

/** Порядок силы пометок целиком — по нему считается пометка папки. */
const STRENGTH: GitLetter[] = ["C", "D", "A", "M", "U"];

/** Сильнейшая из набора: этим папка отвечает за то, что внутри. */
export const strongest = (letters: Iterable<GitLetter>): GitLetter | undefined => {
  const seen = new Set(letters);
  return STRENGTH.find((letter) => seen.has(letter));
};

/**
 * Пометки папок по пометкам файлов: `git status` перечисляет файлы, а ссылка на папку —
 * такой же узел карты, и пустой она читается как «внутри всё чисто».
 */
export function foldersOf(marks: Map<string, GitLetter>): Map<string, GitLetter[]> {
  const folders = new Map<string, GitLetter[]>();

  for (const [path, letter] of marks) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const folder = parts.slice(0, depth).join("/");
      const known = folders.get(folder);
      if (known) known.push(letter);
      else folders.set(folder, [letter]);
    }
  }

  return folders;
}

export function letterOf(xy: string): GitLetter | undefined {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";

  // Неслитое состояние: `U` в любой колонке плюс две пары, где его нет, а конфликт есть.
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "C";
  if (x === "?") return "U";
  // `!!` приходит только с `--ignored`, которого мы не просим; своей буквы у игнорируемого нет.
  if (x === "!") return undefined;

  const left = ofColumn(x);
  const right = ofColumn(y);
  return ORDER.find((letter) => letter === left || letter === right);
}

/**
 * Разбор `git status --porcelain -z -uall`.
 *
 * `-z` взят не ради скорости: без него git заворачивает не-ascii путь в кавычки с октальными
 * escape-последовательностями, и русские имена файлов — а их в карте большинство — пришлось бы
 * разбирать обратно. С `-z` записи разделены нулём и лежат как есть.
 *
 * Переименование занимает две записи: новый путь и следом старый. Старый в ответ не попадает —
 * файла с таким именем на диске уже нет, и узла для него в дереве тоже.
 */
export function parsePorcelain(output: string): Map<string, GitLetter> {
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  const marks = new Map<string, GitLetter>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    if (entry.length < 4) continue;

    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    // Следом за переименованием идёт запись со старым путём — её пропускаем, не разбирая.
    if (xy.includes("R") || xy.includes("C")) index += 1;

    const letter = letterOf(xy);
    if (letter) marks.set(path, letter);
  }

  return marks;
}
