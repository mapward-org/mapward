/**
 * Addresses of map objects and file paths are easy to confuse, so the map has its own scheme.
 * See decision 0005: the scheme says both where we count from and what we get — a path or
 * a value.
 */
export type Address = {
  /** `""` — map root, `~` — current object, `@` — project root (baseUrl of this map). */
  scope: "map" | "self" | "base";
  /** Segments between the scheme and the hash: steps through objects. */
  path: string[];
  /** Segments after the hash: steps through `_index.json` fields. Absent means a path. */
  field?: string[];
};

const SCHEME = "mapward://";

export function isAddress(raw: string): boolean {
  return raw.startsWith(SCHEME);
}

export function parseAddress(raw: string): Address | undefined {
  if (!isAddress(raw)) return undefined;

  const rest = raw.slice(SCHEME.length);
  const hash = rest.indexOf("#");
  const pathPart = hash === -1 ? rest : rest.slice(0, hash);
  const fieldPart = hash === -1 ? undefined : rest.slice(hash + 1);

  const segments = pathPart.split("/").filter(Boolean);
  const [head] = segments;

  const scope = head === "~" ? "self" : head === "@" ? "base" : "map";
  const path = scope === "map" ? segments : segments.slice(1);

  // Behind `@` lies code, not map objects — there are no `_index.json` fields there.
  if (scope === "base" && fieldPart !== undefined) return undefined;

  return {
    scope,
    path,
    field: fieldPart === undefined ? undefined : fieldPart.split(".").filter(Boolean),
  };
}

/** Reads a field path like `props.codePath` out of an object. */
export function readField(source: unknown, field: string[]): unknown {
  let current: unknown = source;
  for (const step of field) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

export const MAP_ROOT = SCHEME;

/** `mapward://` + `apps` is `mapward://apps`, not `mapward:///apps`. */
export function childAddress(parent: string, name: string): string {
  return parent === MAP_ROOT ? MAP_ROOT + name : `${parent}/${name}`;
}

export function mapAddress(path: string[]): string {
  return MAP_ROOT + path.join("/");
}

/**
 * Куда ведёт ссылка — решает её схема, а не настройка метрики (решение 0005). `mapward://` —
 * объект карты, всё остальное со схемой — наружу, без схемы — файл в проекте.
 */
export type LinkKind = "object" | "external" | "file";

export function linkKind(link: string): LinkKind {
  if (isAddress(link)) return "object";
  // Путь вида `d:/repo/file.ts` — это файл, а не схема `d:`.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link)?.[1];
  return scheme && scheme.length > 1 ? "external" : "file";
}
