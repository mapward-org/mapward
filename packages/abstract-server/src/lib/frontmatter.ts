/**
 * Frontmatter файла карты: пара строк между `---` в начале. Свой разбор вместо зависимости —
 * ключи здесь плоские и односложные, а yaml целиком нам ни в одном месте не нужен.
 *
 * Всё, что не разобралось, — просто нет: файл без frontmatter остаётся валидным файлом.
 */
export type Frontmatter = { fields: Record<string, string>; body: string };

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function frontmatter(text: string): Frontmatter {
  const match = FENCE.exec(text);
  if (!match) return { fields: {}, body: text };

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key.length > 0) fields[key] = value;
  }

  return { fields, body: text.slice(match[0].length) };
}

/** `true`, `yes` и голый ключ считаются согласием; всё остальное — нет. */
export const flag = (value: string | undefined): boolean =>
  value === "" || value === "true" || value === "yes";
