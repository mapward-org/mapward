/**
 * Входы сборки компонента — всё, что сборщик спросил у файлов: прочитанные файлы, промахи
 * («такого файла нет» — так ищутся расширения, `index` и пакеты вверх по папкам) и настоящие
 * пути за ссылками. Сборка — чистая функция от этих ответов, версии сборщика и того, что отдаёт
 * карта. Ответы те же — сборка обязана выйти той же, и её можно не повторять. Так зависимости
 * учитываются по построению, а не списком «за чем следить»: обновлённый пакет, новый `index.ts`
 * рядом с `index.tsx`, пакет, поставленный ближе к компоненту, меняют ответы.
 */
export type BuildInputs = {
  /** Путь → отпечаток содержимого; `null` — файла не было. */
  reads: Record<string, string | null>;
  /** Путь → настоящий путь за ссылками. */
  reals: Record<string, string>;
};

/**
 * Отпечаток текста — 53-битный хеш (cyrb53) и длина. Не криптография: сверяется своё же, и
 * случайного совпадения при той же длине достаточно, чтобы его не ждать.
 */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${hash.toString(36)}.${text.length.toString(36)}`;
}

/**
 * Файл пакета: его сверяют размером и временем изменения, а не содержимым — пакеты большие, а
 * меняются целиком, установкой.
 */
export const inPackage = (path: string): boolean =>
  path.replaceAll("\\", "/").includes("/node_modules/");

/** Отпечаток файла пакета по `stat`. */
export const statPrint = (stat: { size: number; mtimeMs: number }): string =>
  `stat:${stat.size}:${Math.round(stat.mtimeMs)}`;
