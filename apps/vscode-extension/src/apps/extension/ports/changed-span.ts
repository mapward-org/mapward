/**
 * Какой кусок текста на самом деле поменялся: общее начало и общий конец остаются на месте.
 *
 * Сервер пишет директиву целиком — новый frontmatter, реплика в конце, — а открытую в редакторе
 * расширение пишет через документ. Замена всего текста уносила курсор в конец и прокручивала
 * директиву вниз; замена только изменившегося куска оставляет курсор и прокрутку там, где были.
 *
 * Границы не режут суррогатную пару: половина символа по одну сторону правки — уже не символ.
 */
export function changedSpan(
  before: string,
  after: string,
): { start: number; end: number; text: string } | undefined {
  if (before === after) return undefined;

  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  if (start > 0 && isHigh(before.charCodeAt(start - 1))) start -= 1;

  let tail = 0;
  while (
    tail < limit - start &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail += 1;
  }
  if (tail > 0 && isLow(before.charCodeAt(before.length - tail))) tail -= 1;

  return {
    start,
    end: before.length - tail,
    text: after.slice(start, after.length - tail),
  };
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
