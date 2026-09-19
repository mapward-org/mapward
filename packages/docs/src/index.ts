/**
 * Документация инструмента, едущая вместе с ним.
 *
 * Агент, которому надо понять, как устроен `_index.json` или из чего собирается метрика,
 * читает это через MCP, а не исходники: у того, кто поставил mapward, исходников нет —
 * решение 0016.
 *
 * Текст лежит в markdown рядом, в папке на язык; `content.generated.ts` собирается из него
 * перед сборкой. Языков пока один, но параметр есть с самого начала: добавить его потом
 * означало бы менять сигнатуры у всех, кто уже зовёт.
 */
export type Language = "ru";

export const LANGUAGES: Language[] = ["ru"];
export const DEFAULT_LANGUAGE: Language = "ru";

export type Section = {
  /** Имя раздела, оно же имя файла без расширения: `model`, `metrics`, `README`. */
  name: string;
  title: string;
  text: string;
};

import { CONTENT } from "./content.generated.ts";

const of = (language: Language | undefined): Section[] =>
  CONTENT[language ?? DEFAULT_LANGUAGE] ?? CONTENT[DEFAULT_LANGUAGE];

/** Оглавление: что вообще есть, без текстов. Первым идёт README — он и есть вход. */
export function sections(language?: Language): { name: string; title: string }[] {
  return of(language).map(({ name, title }) => ({ name, title }));
}

/** Раздел целиком. Имени нет — вернётся `undefined`, выдумывать тут нечего. */
export function section(name: string, language?: Language): Section | undefined {
  return of(language).find((entry) => entry.name === name);
}
