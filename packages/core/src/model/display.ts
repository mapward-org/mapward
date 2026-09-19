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

/** `description` — вторая строка: там проверка говорит, что именно разошлось (решение 0010). */
export type LinkNode = StatusMark & { label?: string; link?: string; description?: string };

export type TreeNode = StatusMark & {
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
  | { kind: "link"; node: LinkNode }
  | { kind: "status"; ok: boolean; summary?: string }
  | { kind: "list"; items: LinkNode[] }
  | { kind: "tree"; children: TreeNode[] }
  | { kind: "map"; nodes: LinkNode[]; relations: MapRelation[] };

/**
 * Те же формы словами — их сервер кладёт в промпт, чтобы агент не угадывал (решение 0004).
 * Текст и типы лежат рядом нарочно: разъедутся — будет видно в одном файле.
 */
export const SHAPES: Record<string, string> = {
  text: '{ "text": string }',
  link: '{ "label"?: string, "link"?: string, "description"?: string, "status"?: "fail" | "success" | "pending" | "idle", "color"?: string, "hint"?: string }',
  status: '{ "ok": boolean, "summary"?: string }',
  list: '{ "items": [{ "label"?: string, "description"?: string, "link"?: string, "status"?: "fail" | "success" | "pending" | "idle", "color"?: string, "hint"?: string }] }',
  tree: '{ "children": [{ "label"?: string, "description"?: string, "link"?: string, "isDir"?: boolean, "status"?: "fail" | "success" | "pending" | "idle", "children"?: [...] }] }',
  map: '{ "nodes": [{ "label"?: string, "link"?: string }], "relations": [{ "from"?: string, "to"?: string, "label"?: string, "link"?: string }] }',
};

export function shapeHint(kind: string | undefined): string {
  const shape = kind ? SHAPES[kind] : undefined;
  return shape
    ? `Ответь только json такой формы, без пояснений: ${shape}`
    : "Ответь только json, без пояснений";
}
