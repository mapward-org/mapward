import Schema from "typebox/schema";

/**
 * Что данные не прошли схему — строкой на поле: путь до него и что ожидалось. Это и есть
 * текст, по которому человек и агент чинят вызов, поэтому путь идёт первым. Так
 * `mapward plugin check` проверяет параметры метода плагина.
 */
export function schemaErrors(schema: unknown, data: unknown): string[] {
  try {
    const [ok, errors] = Schema.Errors(schema as Schema.XSchema, data);
    if (ok) return [];
    return errors.map((error) => `${error.instancePath || "/"}: ${error.message}`);
  } catch (error) {
    return [`схема не читается: ${error instanceof Error ? error.message : String(error)}`];
  }
}
