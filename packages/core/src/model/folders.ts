import { mapAddress, parseAddress } from "./address.ts";

/**
 * Как карта лежит на диске: имена служебных файлов и папок объекта. Модель по ним собирает
 * сервер, а план правки карты в `@mapward/plugin` по ним же пишет файлы — имя одно на обоих.
 */
export const INDEX = "_index.json";
export const METRICS = "_metrics";
export const DIRECTIVES = "_directives";
export const ACTIONS = "_actions";
export const WORKFLOW = "_directives.workflow";
export const CONFIG = "config.json";

/**
 * Объект, которому принадлежит метрика или экшон, по их адресу: `…/_metrics/<ключ>` и
 * `…/_actions/<ключ>` лежат у него. Так их ищут, читая один объект, а не карту целиком.
 * Адрес не метрики и не экшона — `undefined`.
 */
export function memberOwner(address: string): string | undefined {
  const parsed = parseAddress(address);
  if (!parsed || parsed.scope !== "map" || parsed.field) return undefined;
  const folder = parsed.path.at(-2);
  if (parsed.path.length < 2 || (folder !== METRICS && folder !== ACTIONS)) return undefined;
  return mapAddress(parsed.path.slice(0, -2));
}
