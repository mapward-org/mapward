/**
 * Формы данных дисплеев — решения 0004 и 0010.
 *
 * Описаны один раз и здесь: сервер говорит их агенту, клиент по ним проверяет пришедшее.
 * Две копии разъезжались бы молча, а разошедшаяся форма — это метрика, которая показывает
 * «данные не той формы» на верных данных.
 */

/**
 * Четыре состояния несут свой цвет, и этого хватает почти всему, что говорит список: прогон
 * прошёл или упал, работа взята или не начата. Остальное называет свой `color` и объясняет
 * себя в `hint` — решение 0010.
 */
export type StatusMark = { status?: string; color?: string; hint?: string };

/**
 * Что git говорит про файл узла — решение 0023. Буква, а не `status`: цвет у узла один и занят
 * статусом метрики, а показать надо и цвет, и букву, как в редакторе.
 *
 * Строкой, а не объектом: поле висит на каждом узле каждого дерева и целиком уезжает агенту
 * через MCP; расшифровку для тултипа знает клиент, и повторять её в данных незачем.
 */
export type GitLetter = "M" | "A" | "D" | "U" | "C";
export type GitMark = { git?: GitLetter };

/**
 * `description` — вторая строка: там проверка говорит, что именно разошлось (решение 0010).
 * Рисуется разметкой — жирным, кодом и ссылками, — решение 0027.
 */
export type LinkNode = StatusMark &
  GitMark & { label?: string; link?: string; description?: string };

export type TreeNode = StatusMark &
  GitMark & {
    label?: string;
    link?: string;
    description?: string;
    isDir?: boolean;
    children?: TreeNode[];
  };

export type MapRelation = { label?: string; link?: string; from?: string; to?: string };

/** Что дисплей получает после трансформов; `unknown` — это уже ответ клиента, не форма данных. */
export type DisplayShape =
  | { kind: "text"; text: string }
  /**
   * Тот же `{ text }`, что у `text`, но нарисованный разметкой — решение 0027. Форма одна
   * нарочно: тексты в значениях метрик уже лежат, и дисплей меняет их вид, а не их устройство.
   */
  | { kind: "markdown"; text: string }
  | { kind: "link"; node: LinkNode }
  | { kind: "status"; ok: boolean; summary?: string }
  | { kind: "list"; items: LinkNode[] }
  | { kind: "tree"; children: TreeNode[] }
  | { kind: "map"; nodes: LinkNode[]; relations: MapRelation[] }
  /**
   * Свой компонент метрики — решение 0037. Формы у него нет: данные проверяет его схема на
   * сервере, а клиент отдаёт их компоненту как есть.
   */
  | { kind: "component"; data: unknown };

/**
 * Те же формы словами — их сервер кладёт в промпт, чтобы агент не угадывал (решение 0004).
 * Текст и типы лежат рядом нарочно: разъедутся — будет видно в одном файле.
 */
export const SHAPES: Record<string, string> = {
  text: '{ "text": string }',
  markdown: '{ "text": string }, где text — markdown: заголовки, списки, ссылки, код, **жирный**',
  link: '{ "label"?: string, "link"?: string, "description"?: string, "status"?: "fail" | "success" | "pending" | "idle", "color"?: string, "hint"?: string }',
  status: '{ "ok": boolean, "summary"?: string }',
  list: '{ "items": [{ "label"?: string, "description"?: string, "link"?: string, "status"?: "fail" | "success" | "pending" | "idle", "color"?: string, "hint"?: string }] }',
  tree: '{ "children": [{ "label"?: string, "description"?: string, "link"?: string, "isDir"?: boolean, "status"?: "fail" | "success" | "pending" | "idle", "children"?: [...] }] }',
  map: '{ "nodes": [{ "label"?: string, "link"?: string }], "relations": [{ "from"?: string, "to"?: string, "label"?: string, "link"?: string }] }',
};

/**
 * У компонента формы в инструменте нет — её объявляет он сам, JSON-схемой (решение 0037).
 * Схема уходит агенту целиком: это та же подсказка, что у готовых дисплеев, только своя.
 */
export function shapeHint(kind: string | undefined, schema?: unknown): string {
  if (kind === "component" && schema !== undefined) {
    return `Ответь только json, который проходит эту JSON-схему, без пояснений: ${JSON.stringify(schema)}`;
  }
  const shape = kind ? SHAPES[kind] : undefined;
  return shape
    ? `Ответь только json такой формы, без пояснений: ${shape}`
    : "Ответь только json, без пояснений";
}

/**
 * Собранный компонент метрики — решение 0037. Код — CommonJS: `react` и `@mapward/display` в
 * нём не лежат, их отдаёт клиент, иначе на странице две копии React и хуки ломаются.
 *
 * `errors` вместо кода — сборка не прошла; строки уже с файлом и позицией, клиенту остаётся
 * их показать.
 */
export type DisplayBuild = {
  code?: string;
  css?: string;
  errors?: string[];
  builtAt: string;
};
