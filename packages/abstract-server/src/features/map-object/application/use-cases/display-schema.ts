import { shapeHint } from "@mapward/core";
import type { MapMetric } from "@mapward/core";
import type { FilesPort } from "../../../../ports/index.ts";
import { knownRefs, schemaErrors } from "../../domain/component.ts";

type Display = MapMetric["config"]["display"];

/**
 * Схема данных компонента — решение 0037: объектом в `config.json` или путём к `.json`. Путь к
 * этому моменту уже абсолютный: его привязал к своему слою `readMap`.
 *
 * Не прочиталась — это ошибка, а не отсутствие схемы: метрика, которая молча перестала
 * проверяться, выглядит исправной.
 */
export async function readDisplaySchema(
  files: FilesPort,
  display: Display,
): Promise<{ schema?: unknown; error?: string }> {
  const schema = display?.schema;
  if (schema === undefined) return {};
  if (typeof schema !== "string") return { schema };

  const text = await files.read(schema);
  if (text === undefined) return { error: `схема не найдена: ${schema}` };
  try {
    return { schema: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      error: `схема ${schema} — не json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Что сказать агенту о форме ответа: у компонента — его схема, у готовых — их форма. */
export async function displayHint(files: FilesPort, display: Display): Promise<string> {
  const { schema } = await readDisplaySchema(files, display);
  // Агент имени `mapward:action` не знает: ему уходит сама форма экшона строки (решение 0038).
  return shapeHint(display?.kind, schema === undefined ? undefined : knownRefs(schema));
}

/**
 * Данные против схемы компонента. Пусто — прошли или проверять нечем: у готового дисплея
 * форму проверяет клиент (решение 0004), здесь только компонент.
 */
export async function checkDisplayData(
  files: FilesPort,
  display: Display,
  data: unknown,
): Promise<string[]> {
  if (display?.kind !== "component") return [];
  const { schema, error } = await readDisplaySchema(files, display);
  if (error) return [error];
  if (schema === undefined) return [];
  return schemaErrors(schema, data);
}
