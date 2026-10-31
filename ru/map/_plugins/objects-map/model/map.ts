import type { MapMetric, MapObject } from "@mapward/plugin";

/**
 * Адреса карты и поиск по снимку `ctx.tree` — то немногое из модели карты, что нужно холсту.
 * Модель ведёт платформа, а своей копии `@mapward/core` у плагина в карте нет, поэтому здесь.
 */

export const MAP_ROOT = "mapward://";

/** `mapward://` + `apps` — `mapward://apps`, а не `mapward:///apps`. */
export const childAddress = (parent: string, name: string): string =>
  parent === MAP_ROOT ? MAP_ROOT + name : `${parent}/${name}`;

export function walk(object: MapObject, visit: (object: MapObject) => void): void {
  visit(object);
  for (const child of object.children) walk(child, visit);
}

export function findObject(root: MapObject, address: string): MapObject | undefined {
  if (root.address === address) return root;
  for (const child of root.children) {
    const found = findObject(child, address);
    if (found) return found;
  }
  return undefined;
}

/** Цепочка объектов от корня до адреса; нет такого — пусто. */
export function trail(root: MapObject, address: string): MapObject[] {
  if (root.address === address) return [root];
  for (const child of root.children) {
    const inside = trail(child, address);
    if (inside.length > 0) return [root, ...inside];
  }
  return [];
}

/** Метрика по адресу и объект, которому она принадлежит. */
export function findMetricOwner(
  root: MapObject,
  address: string,
): { object: MapObject; metric: MapMetric } | undefined {
  const own = root.metrics.find((metric) => metric.address === address);
  if (own) return { object: root, metric: own };
  for (const child of root.children) {
    const found = findMetricOwner(child, address);
    if (found) return found;
  }
  return undefined;
}

/** Объект, у которого лежит метрика: `…/_metrics/<ключ>` — у `…`. Не метрика — `undefined`. */
export function memberOwner(address: string): string | undefined {
  if (!address.startsWith(MAP_ROOT) || address.includes("#")) return undefined;
  const path = address.slice(MAP_ROOT.length).split("/").filter(Boolean);
  if (path.length < 2 || path.at(-2) !== "_metrics") return undefined;
  return MAP_ROOT + path.slice(0, -2).join("/");
}

/** Имя папки из подписи — то же, что у платформы, которая создаёт объект. */
export function slug(name: string): string {
  const folder = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "");
  return folder || "объект";
}
