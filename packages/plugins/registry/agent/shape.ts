/**
 * Форма ответа агента словами — её кладёт в конец промпта `ask`/`refresh`, чтобы агент не угадывал
 * (решение 0004). Формы — данные готовых видов плагина `views`: `{ text }`, `{ items }`,
 * `{ children }`, … Поменяли вид — поправьте и форму здесь. Это код проекта: правь под себя.
 */
const ACTION_FIELDS =
  '"action"?: { "run": string, "inputs"?: object } — кнопка на строке, "actions"?: [{ "run": string, "inputs"?: object }] — меню строки';
const OBJECT_FIELDS =
  '"object"?: "mapward://… — пункт станет карточкой объекта", "group"?: string, "width"?: string | number, "maxHeight"?: string | number';

export const SHAPES: Record<string, string> = {
  text: '{ "text": string }',
  markdown: '{ "text": string }, где text — markdown: заголовки, списки, ссылки, код, **жирный**',
  link: '{ "label"?: string, "link"?: string, "description"?: string, "status"?: "fail" | "success" | "pending" | "idle", "color"?: string, "hint"?: string }',
  status: '{ "ok": boolean, "summary"?: string }',
  list: `{ "items": [{ "label"?: string, "description"?: string, "link"?: string, "status"?: "fail" | "success" | "pending" | "idle", "color"?: string, "hint"?: string, ${ACTION_FIELDS}, ${OBJECT_FIELDS} }] }`,
  tree: `{ "children": [{ "label"?: string, "description"?: string, "link"?: string, "isDir"?: boolean, "status"?: "fail" | "success" | "pending" | "idle", ${ACTION_FIELDS}, ${OBJECT_FIELDS}, "children"?: [...] }] }`,
  object:
    '{ "object": "mapward://…", "group"?: string, "width"?: string | number, "maxHeight"?: string | number }',
};

/**
 * Подсказка агенту о форме ответа: имя вида (`list`, `tree`, …) — его форма словами, объект —
 * JSON-схема как есть. Без формы — просто «только json».
 */
export function shapeHint(shape?: unknown): string {
  if (typeof shape === "object" && shape !== null) {
    return `Ответь только json, который проходит эту JSON-схему, без пояснений: ${JSON.stringify(shape)}`;
  }
  const known = typeof shape === "string" ? SHAPES[shape] : undefined;
  return known
    ? `Ответь только json такой формы, без пояснений: ${known}`
    : "Ответь только json, без пояснений";
}
