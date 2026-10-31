/**
 * Ключ запроса компонента — `useQuery(ключ, …)` и `useStream(ключ, …)`, как `queryKey` в
 * react-query: строка или массив из JSON. Ключ — это и зависимости запроса (поменялся — новый
 * запрос), и место в памяти последних ответов вида.
 */
export type CallKey = string | readonly unknown[];

/** Объект с ключами по порядку: `{ a, b }` и `{ b, a }` — один ключ. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Ключ строкой — по содержимому, а не по тождеству: ключ пишут литералом прямо в вызове, и новый
 * массив на каждый кадр не должен перезапускать запрос.
 */
export const callId = (key: CallKey): string => JSON.stringify(stable(key)) ?? "";
