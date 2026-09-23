import type { ProcessEnv } from "../../../lib/env.ts";

/**
 * Проверка полей живёт в `core` — ей пользуется и клиент, решая, открывать ли форму. Здесь
 * она переотдаётся, а своё у сервера — то, как данные доезжают до скрипта и промпта.
 */
export { checkInputs, complete, type CheckedInputs } from "@mapward/core";

/** `MAPWARD_INPUT_<ИМЯ>` — для скрипта, которому JSON во входе разбирать незачем. */
export function inputEnv(values: Record<string, unknown>): ProcessEnv {
  return Object.fromEntries([
    ["MAPWARD_INPUTS", JSON.stringify(values)],
    ...Object.entries(values).map(([name, value]) => [
      `MAPWARD_INPUT_${name.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_")}`,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  ]);
}

/**
 * Значения формы в тексте промпта: `${{ inputs.<имя> }}`. Подстановка карты разрешает адреса и
 * до данных формы не достаёт — они приходят в момент запуска, а не при чтении карты.
 */
export function fillInputs(text: string, values: Record<string, unknown>): string {
  return text.replaceAll(/\$\{\{\s*inputs\.([\w-]+)\s*\}\}/g, (whole, name: string) => {
    if (!(name in values)) return whole;
    const value = values[name];
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}
