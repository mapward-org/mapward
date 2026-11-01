/**
 * Разбор tar-архива ветки — того, что отдаёт GitHub (`codeload.github.com/…/tar.gz/…`), уже
 * распакованного из gzip. Чистая функция над байтами: распаковку и декодирование текста делает
 * хост, у сервера своего окружения нет.
 *
 * GitHub кладёт всё в верхнюю папку `владелец-репозиторий-коммит/`, а сам коммит — в глобальный
 * pax-заголовок, записью `comment=<sha>`, как `git archive`. Верхняя папка срезается.
 */

import type { Archive } from "../../../ports/index.ts";

export type { Archive };

/** Текст UTF-8 или `undefined`, если байты текстом не читаются. */
export type Decode = (bytes: Uint8Array) => string | undefined;

const BLOCK = 512;
const SPACE = 0x20;

/** Строковое поле заголовка: до первого нуля. */
function field(block: Uint8Array, start: number, length: number, decode: Decode): string {
  let end = start;
  while (end < start + length && block[end] !== 0) end += 1;
  return decode(block.subarray(start, end)) ?? "";
}

/**
 * pax-записи: `<длина> ключ=значение\n` подряд. Длина — в байтах, а не в знаках, поэтому режем
 * байты и декодируем каждую запись отдельно.
 */
function pax(bytes: Uint8Array, decode: Decode): Record<string, string> {
  const records: Record<string, string> = {};
  let offset = 0;
  while (offset < bytes.length) {
    let space = offset;
    while (space < bytes.length && bytes[space] !== SPACE) space += 1;
    const length = Number(decode(bytes.subarray(offset, space)));
    if (!Number.isInteger(length) || length <= 0) break;
    const record = decode(bytes.subarray(space + 1, offset + length - 1)) ?? "";
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return records;
}

export function untar(bytes: Uint8Array, decode: Decode): Archive {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let commit: string | undefined;
  let longName: string | undefined;
  let offset = 0;

  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12, decode).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = bytes.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "g") {
      commit = pax(body, decode).comment ?? commit;
      continue;
    }
    if (type === "x") {
      longName = pax(body, decode).path;
      continue;
    }
    if (type === "L") {
      longName = decode(body)?.replace(/\0+$/, "");
      continue;
    }

    const prefix = field(header, 345, 155, decode);
    const short = field(header, 0, 100, decode);
    const name = longName ?? (prefix ? `${prefix}/${short}` : short);
    longName = undefined;
    // Только обычные файлы: папки видны по путям, ссылки в копию не нужны.
    if (type !== "0" && type !== "\0") continue;

    const path = name.split("/").slice(1).join("/");
    if (!path) continue;
    const text = decode(body);
    if (text === undefined) skipped.push(path);
    else files[path] = text;
  }

  return { ...(commit ? { commit } : {}), files, skipped };
}
