/**
 * Глубокая копия данных: массивы и простые объекты копируются, остальное берётся как есть.
 * `structuredClone` здесь нет — пакет не знает, где запущен, — а JSON потерял бы ключи со
 * значением `undefined`, по присутствию которых мердж решает, заявлено ли поле.
 */
export function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)]),
  ) as T;
}
