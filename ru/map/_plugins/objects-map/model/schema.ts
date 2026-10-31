/**
 * JSON-схемы операций холста — их видит агент в самоописании плагина, по ним метод `edit`
 * проверяет пачку (`schemaErrors` из `@mapward/plugin`). Пишутся руками, а не typebox: операции
 * знает и холст в окне, а окну typebox платформа не даёт, — схема же просто объект.
 */

export const string = { type: "string" } as const;
export const number = { type: "number" } as const;

export const literal = <const Value extends string>(value: Value) => ({ const: value }) as const;

export const union = <const Schemas extends readonly object[]>(...anyOf: Schemas) =>
  ({ anyOf }) as const;

export const array = <const Item extends object>(items: Item) =>
  ({ type: "array", items }) as const;

/** Объект с любыми ключами и значениями одной схемы. */
export const record = <const Value extends object>(value: Value) =>
  ({ type: "object", additionalProperties: value }) as const;

/** Объект: `required` — обязательные поля, `optional` — необязательные. */
export const object = <const Required extends object, const Optional extends object = {}>(
  required: Required,
  optional?: Optional,
) =>
  ({
    type: "object",
    properties: { ...required, ...optional },
    required: Object.keys(required),
  }) as const;
