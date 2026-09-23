/**
 * Пути внутри сервера — строки с прямыми слэшами. `node:path` здесь взять неоткуда: пакет не
 * знает, где запущен, и в браузере его тоже нет.
 */
export const slash = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

export function join(...parts: string[]): string {
  const joined = parts
    .map((part, index) => (index === 0 ? slash(part) : slash(part).replace(/^\/+/, "")))
    .filter(Boolean)
    .join("/");
  return normalize(joined);
}

/** `.` и `..` схлопываются здесь: иначе они доезжают до ссылки, которую увидит человек. */
export function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];

  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && out.length > 0 && out.at(-1) !== "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }

  return (absolute ? "/" : "") + out.join("/");
}

export function dirname(path: string): string {
  const cut = slash(path).lastIndexOf("/");
  return cut === -1 ? "" : slash(path).slice(0, cut);
}

export function basename(path: string): string {
  return slash(path).split("/").at(-1) ?? "";
}

/** Путь от корня: им объект называет себя скрипту метрики — решение 0004. */
export function relative(root: string, path: string): string {
  const from = slash(root);
  const to = slash(path);
  return to.startsWith(from) ? to.slice(from.length).replace(/^\/+/, "") : to;
}
