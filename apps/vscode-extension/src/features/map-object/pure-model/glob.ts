/**
 * Globs for `read-dir` — decision 0004 promised `include` and `exclude`, and until now only
 * a rough name check stood in for them.
 *
 * Paths are matched relative to the collector's `basePath`, with `/` as the separator on every
 * platform: a config is written once and read on Windows too.
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

/** No globs means no filter: an empty `include` includes everything, as it reads. */
export function matchesAny(path: string, globs: string[] | undefined): boolean {
  return !globs || globs.length === 0 || globs.some((glob) => matchesGlob(path, glob));
}

export function excluded(path: string, globs: string[] | undefined): boolean {
  return Boolean(globs?.some((glob) => matchesGlob(path, glob)));
}
