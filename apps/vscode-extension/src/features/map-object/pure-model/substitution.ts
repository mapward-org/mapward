import { parseAddress } from "./address.ts";

/**
 * `${{ … }}` with explicit borders so map expressions never collide with shell or prompt
 * text that happens to contain `$` or `${`. See decision 0006.
 */
const EXPRESSION = /\$?\$\{\{\s*([^}]*?)\s*\}\}/g;

export type Resolve = (raw: string) => string | undefined;

/** Substitution happens after `extends` is resolved, so `~` means the concrete object. */
export function substitute(input: string, resolve: Resolve): string {
  return input.replaceAll(EXPRESSION, (whole, expression: string) => {
    // A leading `$` escapes the expression: it stays as text, minus the escape.
    if (whole.startsWith("$$")) return whole.slice(1);

    const value = parseAddress(expression) ? resolve(expression) : undefined;
    // A failed lookup is not fatal: the metric shows an error, the rest of the map lives on.
    return value ?? `«не разрешилось: ${expression}»`;
  });
}

/** Walks a parsed json and substitutes inside every string it holds. */
export function substituteDeep<T>(value: T, resolve: Resolve): T {
  if (typeof value === "string") return substitute(value, resolve) as T;
  if (Array.isArray(value)) return value.map((item) => substituteDeep(item, resolve)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteDeep(item, resolve)]),
    ) as T;
  }
  return value;
}
