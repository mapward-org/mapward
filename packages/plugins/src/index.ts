/**
 * Встроенные плагины — по модели shadcn: исходники лежат здесь реестром, а в карту
 * (`_plugins/<имя>/`) копируются один раз. Дальше это код проекта: его правят человек и агент,
 * и mapward его не перезаписывает никогда.
 *
 * Плагин — обычная папка `registry/<имя>/` с `index.ts`; `sources.generated.ts` собирается из
 * неё перед сборкой. Пакет не знает никого: что делать с текстом, решает сервер.
 */
import { SOURCES } from "./sources.generated.ts";

/** Файлы плагина: путь от его папки — текст. */
export type PluginSources = Readonly<Record<string, string>>;

export const builtinPlugins: Readonly<Record<string, PluginSources>> = SOURCES;

export const builtinNames: readonly string[] = Object.keys(SOURCES);
