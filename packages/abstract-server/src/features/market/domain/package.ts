import type { MarketKind } from "./registry.ts";

/**
 * Что лежит в репозитории автора и как это ложится в карту. Репозиторий — один плагин или один
 * кусок карты в корне:
 *
 * - плагин — `index.ts` (`.tsx`, `.js`) с `definePlugin` в корне; копируется в `_plugins/<имя>`
 *   целиком;
 * - кусок карты — папки объектов в корне, каждая с `_index.json`, как под корнем карты; ставится
 *   копией под выбранного родителя. Нужные ему плагины из реестра — в `market.json` корня:
 *   `{ "plugins": ["имя", …] }`.
 */

/** Запись «откуда» рядом с установленным: по ней агент сравнивает копию с веткой автора. */
export const ORIGIN_FILE = ".market.json";

/** Манифест куска карты в корне его репозитория. */
export const MANIFEST_FILE = "market.json";

export type Origin = {
  kind: MarketKind;
  name: string;
  registry: string;
  repo: string;
  branch: string;
  commit: string;
  /** У куска карты — папка объекта в репозитории и адрес родителя, под которого его поставили. */
  top?: string;
  parent?: string;
};

/** Что из репозитория не едет в карту: служебное git и GitHub, зависимости, чужая запись «откуда». */
export function copied(path: string): boolean {
  const first = path.split("/")[0] ?? "";
  if (first === ".git" || first === ".github" || path === ORIGIN_FILE) return false;
  return !path.split("/").includes("node_modules");
}

const PLUGIN_ENTRY = /^index\.(ts|tsx|js)$/;

/** Файлы плагина для копии; не плагин — причина. */
export function pluginFiles(
  files: Readonly<Record<string, string>>,
): { files: Record<string, string> } | { error: string } {
  const paths = Object.keys(files).filter(copied);
  if (!paths.some((path) => PLUGIN_ENTRY.test(path))) {
    return { error: "в корне репозитория нет index.ts (.tsx, .js) с definePlugin — это не плагин" };
  }
  return { files: Object.fromEntries(paths.map((path) => [path, files[path] ?? ""])) };
}

/** Папки объектов куска: в корне, не служебные, с `_index.json`. */
export function pieceTops(files: Readonly<Record<string, string>>): string[] {
  const tops = new Set<string>();
  for (const path of Object.keys(files)) {
    const [top, second] = path.split("/");
    if (!top || second !== "_index.json" || path.split("/").length !== 2) continue;
    if (top.startsWith("_") || top.startsWith(".")) continue;
    tops.add(top);
  }
  return [...tops].toSorted();
}

/** Плагины, которые кусок просит поставить первыми; кривой манифест — причина. */
export function pieceManifest(
  files: Readonly<Record<string, string>>,
): { plugins: string[] } | { error: string } {
  const text = files[MANIFEST_FILE];
  if (text === undefined) return { plugins: [] };
  try {
    const parsed = JSON.parse(text) as { plugins?: unknown };
    const plugins = parsed.plugins ?? [];
    if (!Array.isArray(plugins) || plugins.some((name) => typeof name !== "string")) {
      return { error: `${MANIFEST_FILE}: plugins — массив имён плагинов` };
    }
    return { plugins: plugins as string[] };
  } catch (error) {
    return { error: `${MANIFEST_FILE} не json: ${String(error)}` };
  }
}

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Адреса объектов куска — на новое место. В репозитории кусок лежит под корнем, и его объекты
 * зовутся `mapward://<папка>`; под родителем они — `<родитель>/<папка>`. Переписывается адрес
 * везде, где он стоит в тексте json: значением, в подстановке `${{ … }}`, с хвостом `/…` и `#…`.
 * Чужие адреса — прототипы карты, `${{ mapward:// }}/_plugins/…` — остаются: плагины куска
 * ставятся в `_plugins` той же карты.
 */
export function relocateText(text: string, tops: readonly string[], parent: string): string {
  if (parent === "mapward://" || tops.length === 0) return text;
  const base = parent.replace(/\/+$/, "");
  const pattern = new RegExp(`mapward://(${tops.map(escape).join("|")})(?=[/#"\\s}]|$)`, "g");
  return text.replaceAll(pattern, (_match, top: string) => `${base}/${top}`);
}

/** Файлы одного объекта куска: путь от его папки — текст на новом месте. */
export function pieceFiles(
  files: Readonly<Record<string, string>>,
  top: string,
  tops: readonly string[],
  parent: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith(`${top}/`) || !copied(path)) continue;
    const relative = path.slice(top.length + 1);
    // Директивы — история оригинала, а не часть куска.
    if (relative.split("/").includes("_directives")) continue;
    result[relative] = path.endsWith(".json") ? relocateText(text, tops, parent) : text;
  }
  return result;
}

export type FileChangeKind = "added" | "changed" | "removed";

export type DiffEntry = {
  path: string;
  /** Что сделал автор с записанного коммита. */
  author?: FileChangeKind;
  /** Что сделали с копией в карте. */
  local?: FileChangeKind;
};

function change(before: string | undefined, after: string | undefined): FileChangeKind | undefined {
  if (before === after) return undefined;
  if (before === undefined) return "added";
  if (after === undefined) return "removed";
  return "changed";
}

/**
 * Три состояния файлов: записанный коммит, ветка автора, копия в карте. Строка — файл, который
 * изменился хоть с одной стороны; одинаковые не называются.
 */
export function diffThree(
  base: Readonly<Record<string, string>>,
  author: Readonly<Record<string, string>>,
  local: Readonly<Record<string, string>>,
): DiffEntry[] {
  const paths = new Set([...Object.keys(base), ...Object.keys(author), ...Object.keys(local)]);
  const entries: DiffEntry[] = [];
  for (const path of [...paths].toSorted()) {
    const byAuthor = change(base[path], author[path]);
    const byLocal = change(base[path], local[path]);
    if (!byAuthor && !byLocal) continue;
    entries.push({
      path,
      ...(byAuthor ? { author: byAuthor } : {}),
      ...(byLocal ? { local: byLocal } : {}),
    });
  }
  return entries;
}
