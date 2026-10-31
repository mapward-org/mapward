import type { ActionConfig, ActionInput } from "./configs.ts";

/**
 * Проверка полей формы экшона — решение 0038. Лежит в `core`, а не у сервера: сервер по ней
 * решает, запускать ли, а клиент — открывать ли форму. Две копии разъехались бы молча, и кнопка
 * запускала бы без формы то, что сервер потом отвергнет.
 */
export type CheckedInputs = {
  values: Record<string, unknown>;
  /** Поле → что с ним не так. Пусто — форма годится. */
  errors: Record<string, string>;
};

const kindOf = (input: ActionInput) => input.type ?? "string";

/** Пришедшее из формы, MCP и терминала — строкой или значением: `--input n=3` это строка «3». */
function coerce(input: ActionInput, raw: unknown): { value?: unknown; error?: string } {
  switch (kindOf(input)) {
    case "boolean":
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true" || raw === "false") return { value: raw === "true" };
      return { error: "ждётся да или нет" };
    case "number": {
      const value = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(value) ? { value } : { error: "ждётся число" };
    }
    case "choice": {
      const value = String(raw);
      return input.options?.includes(value)
        ? { value }
        : { error: `ждётся одно из: ${(input.options ?? []).join(", ")}` };
    }
    default:
      return { value: String(raw) };
  }
}

const empty = (raw: unknown) => raw === undefined || raw === null || raw === "";

/**
 * Данные формы проверяет сервер, а не вид — решение 0038: иначе агент через MCP и человек в
 * терминале обходили бы обязательные поля. Непереданное берёт умолчание, неизвестное поле —
 * ошибка: опечатка в имени иначе молча превратилась бы в пустое значение.
 */
export function checkInputs(
  declared: ActionConfig["inputs"],
  given: Record<string, unknown>,
): CheckedInputs {
  const inputs = declared ?? {};
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const name of Object.keys(given)) {
    if (!(name in inputs)) errors[name] = "у экшона нет такого поля";
  }

  for (const [name, input] of Object.entries(inputs)) {
    const raw = empty(given[name]) ? input.default : given[name];
    if (empty(raw)) {
      // Флажок без значения — это «нет», а не пропуск: у него не бывает третьего состояния.
      if (kindOf(input) === "boolean") values[name] = false;
      else if (input.required) errors[name] = "обязательное поле";
      continue;
    }
    const { value, error } = coerce(input, raw);
    if (error) errors[name] = error;
    else values[name] = value;
  }

  return { values, errors };
}

/**
 * Хватает ли данных, чтобы запустить без формы: всё обязательное заполнено умолчаниями или
 * переданным. Тот же ответ, что даст сервер, поэтому клиент спрашивает его, а не угадывает.
 */
export const complete = (declared: ActionConfig["inputs"], given: Record<string, unknown>) =>
  Object.keys(checkInputs(declared, given).errors).length === 0;

/**
 * Значения формы в тексте: `${{ inputs.<имя> }}`. Подстановка карты разрешает адреса и до данных
 * формы не достаёт — они приходят в момент запуска, а не при чтении карты. Лежит здесь, потому что
 * тем же путём заполняется и вопрос подтверждения: его показывает клиент, а агенту — MCP.
 */
export function fillInputs(text: string, values: Record<string, unknown>): string {
  return text.replaceAll(/\$\{\{\s*inputs\.([\w-]+)\s*\}\}/g, (whole, name: string) => {
    if (!(name in values)) return whole;
    const value = values[name];
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/**
 * Вопрос перед запуском: `confirm` текстом, с данными формы. `true` вопроса не задаёт — он лишь
 * открывает форму, и кнопка формы сама служит подтверждением. `form` — поля формы экшона
 * ({@link actionForm}); без них берутся `inputs`.
 */
export function confirmQuestion(
  config: ActionConfig,
  given: Record<string, unknown>,
  form: ActionConfig["inputs"] = config.inputs,
): string | undefined {
  if (typeof config.confirm !== "string") return undefined;
  return fillInputs(config.confirm, checkInputs(form, given).values);
}

type SchemaProperty = {
  type?: unknown;
  enum?: unknown;
  description?: unknown;
  default?: unknown;
  format?: unknown;
};

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/**
 * Свойство схемы — полем формы. Объект, массив и свойство без типа (`anyOf` и прочее) в простую
 * форму не ложатся — `undefined`.
 */
function inputOf(property: SchemaProperty, required: boolean): ActionInput | undefined {
  const type = Array.isArray(property.type) ? property.type[0] : property.type;
  const common = {
    ...(typeof property.description === "string" ? { description: property.description } : {}),
    ...(isPrimitive(property.default) ? { default: property.default } : {}),
    ...(required ? { required: true } : {}),
  };
  if (Array.isArray(property.enum)) {
    return { type: "choice", options: property.enum.map(String), ...common };
  }
  if (type === "boolean") return { type: "boolean", ...common };
  if (type === "number" || type === "integer") return { type: "number", ...common };
  if (type === "string") {
    // Абзац, а не слово: `format: "multiline"` — так схема просит многострочное поле.
    return {
      type: "string",
      ...(property.format === "multiline" ? { multiline: true } : {}),
      ...common,
    };
  }
  return undefined;
}

/**
 * Поля формы по JSON-схеме параметров метода: всё, чего нет в `given` — заданных параметрах
 * экшона. Объекты и массивы в форму не попадают: их задают в `params`.
 */
export function schemaInputs(
  schema: unknown,
  given: Record<string, unknown> = {},
): Record<string, ActionInput> {
  if (typeof schema !== "object" || schema === null) return {};
  const { properties, required } = schema as { properties?: unknown; required?: unknown };
  if (typeof properties !== "object" || properties === null) return {};
  const needed = new Set(Array.isArray(required) ? required.map(String) : []);
  return Object.fromEntries(
    Object.entries(properties as Record<string, SchemaProperty>).flatMap(([name, property]) => {
      if (name in given) return [];
      const input = inputOf(property ?? {}, needed.has(name));
      return input ? [[name, input] as const] : [];
    }),
  );
}

/**
 * Форма экшона: `inputs`, если они написаны (пустые `{}` — формы нет вовсе), иначе схема
 * параметров метода без заданных в `params`. Один ответ на сервере и в
 * клиенте: форма, которую видит человек, — та, что проверит сервер.
 */
export const actionForm = (config: ActionConfig, schema?: unknown): Record<string, ActionInput> =>
  config.inputs ?? schemaInputs(schema, config.params);

/**
 * Аргументы метода: заданные параметры и данные формы. Форма по схеме — это недостающие
 * параметры, и они ложатся рядом; форма по `inputs` — данные, о которых метод знает одним полем
 * `inputs`: так их получают `shell` и `agent`.
 */
export const actionArgs = (
  config: ActionConfig,
  values: Record<string, unknown>,
): Record<string, unknown> =>
  config.inputs === undefined
    ? { ...config.params, ...values }
    : { ...config.params, inputs: values };
