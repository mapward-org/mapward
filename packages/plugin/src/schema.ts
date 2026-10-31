import Schema from "typebox/schema";

/**
 * Что данные не прошли схему — строкой на поле: путь до него и что ожидалось. По этому тексту
 * агент чинит вызов, поэтому путь идёт первым. Пусто — данные подходят.
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
