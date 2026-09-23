/** Дефисы и подчёркивания имени читаются пробелами: слово набирают так, как его видят. */
const words = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .trim();

/**
 * Совпадение для поиска по экрану объекта: подстрока без регистра хотя бы в одном из текстов.
 * Одно правило на все разделы, иначе одинаковый запрос находил бы в соседних разделах разное.
 * Пустой запрос совпадает со всем — пока ничего не набрано, ничего и не отбирается.
 */
export const matches = (query: string, ...texts: (string | undefined)[]): boolean => {
  const needle = words(query);
  return needle === "" || texts.some((text) => text !== undefined && words(text).includes(needle));
};
