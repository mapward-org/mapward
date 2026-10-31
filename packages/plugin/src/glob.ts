/**
 * Глобы для плагинов: `**` — любое число сегментов, `*` и `?` — внутри одного. Разделитель —
 * `/` на любой платформе: конфиг пишется один раз и читается и на Windows. С чем сверять путь —
 * относительный или абсолютный, — решает тот, кто зовёт: так их зовут встроенные `files` и
 * `shell`.
 */

const special = /[.+^${}()|[\]\\]/g;

/**
 * `**` spans any number of segments including none, so `**\/node_modules/**` matches the folder
 * itself as well as everything under it — otherwise a walk would descend into it before
 * noticing.
 */
function toRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const rest = glob.slice(index);

    if (rest.startsWith("**/")) {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (rest === "/**") {
      source += "(?:/.*)?";
      index += 2;
      continue;
    }
    if (rest.startsWith("**")) {
      source += ".*";
      index += 1;
      continue;
    }

    const char = glob[index] ?? "";
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(special, "\\$&");
  }

  return new RegExp(`^${source}$`);
}

const cache = new Map<string, RegExp>();

function pattern(glob: string): RegExp {
  const known = cache.get(glob);
  if (known) return known;
  const made = toRegExp(glob);
  cache.set(glob, made);
  return made;
}

export function matchesGlob(path: string, glob: string): boolean {
  return pattern(glob).test(path);
}

/** Без глобов фильтра нет: пустой `include` пропускает всё — как и читается. */
export function matchesAny(path: string, globs: string[] | undefined): boolean {
  return !globs || globs.length === 0 || globs.some((glob) => matchesGlob(path, glob));
}

export function excluded(path: string, globs: string[] | undefined): boolean {
  return Boolean(globs?.some((glob) => matchesGlob(path, glob)));
}

/**
 * Папка, за которой следить ради глоба: сегменты до первого со звёздочкой или вопросом.
 * `src/**\/*.ts` — `src`, `a/b.md` — `a`, `*.md` — пусто: следить надо за самой папкой отсчёта.
 */
export function globBase(glob: string): string {
  const segments = glob.split("/");
  const stop = segments.findIndex((segment) => /[*?]/.test(segment));
  const fixed = stop === -1 ? segments.slice(0, -1) : segments.slice(0, stop);
  return fixed.join("/");
}
