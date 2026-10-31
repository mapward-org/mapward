/**
 * An agent answers in prose unless asked otherwise, and even when asked it likes a fence. We
 * take the first json object or array we can parse; failing that the text itself is the answer,
 * which at least shows on a `text` display instead of an error.
 */
export function parseAnswer(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]?.trim();
  const candidates = [fenced, text].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.search(/[{[]/);
      const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
      if (start === -1 || end <= start) continue;
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        continue;
      }
    }
  }

  return { text };
}
