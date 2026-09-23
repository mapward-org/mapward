import { shapeHint } from "@mapward/core";
import type { MapMetric } from "@mapward/core";
import type { FileReader } from "../../../../ports/index.ts";
import { knownRefs, schemaErrors } from "../../domain/component.ts";

export type Display = MapMetric["config"]["display"];

/**
 * Схема данных компонента — решение 0037: объектом в `config.json` или путём к `.json`. Путь к
 * этому моменту уже абсолютный: его привязало к своему слою чтение карты.
 *
 * Сервис, а не юзкейс: схему читают и сбор метрики (подсказка агенту), и стор (проверка
 * данных), и MCP — метрики берут его через свой порт.
 */
export class DisplaySchema {
  constructor(private readonly files: FileReader) {}

  /**
   * Не прочиталась — это ошибка, а не отсутствие схемы: метрика, которая молча перестала
   * проверяться, выглядит исправной.
   */
  async read(display: Display): Promise<{ schema?: unknown; error?: string }> {
    const schema = display?.schema;
    if (schema === undefined) return {};
    if (typeof schema !== "string") return { schema };

    const text = await this.files.read(schema);
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
  async hint(display: Display): Promise<string> {
    const { schema } = await this.read(display);
    // Агент имени `mapward:action` не знает: ему уходит сама форма экшона строки (решение 0038).
    return shapeHint(display?.kind, schema === undefined ? undefined : knownRefs(schema));
  }

  /**
   * Данные против схемы компонента. Пусто — прошли или проверять нечем: у готового дисплея
   * форму проверяет клиент (решение 0004), здесь только компонент.
   */
  async check(display: Display, data: unknown): Promise<string[]> {
    if (display?.kind !== "component") return [];
    const { schema, error } = await this.read(display);
    if (error) return [error];
    if (schema === undefined) return [];
    return schemaErrors(schema, data);
  }
}
