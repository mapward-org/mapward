import type { ActionConfig, ActionInput } from "./schema.ts";

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
