import type { CardItem, LinkItem, TreeItem } from "./types.ts";

/** Что рисует `Display` по виду. */
export type Shape =
  | { kind: "text"; text: string }
  /** Тот же `{ text }`, что у `text`, но нарисованный разметкой — решение 0027. */
  | { kind: "markdown"; text: string }
  | { kind: "link"; item: LinkItem }
  | { kind: "status"; ok: boolean; summary?: string | undefined }
  | { kind: "list"; items: LinkItem[] }
  | { kind: "tree"; children: TreeItem[] }
  /** Одиночный объект карточкой. */
  | { kind: "object"; item: CardItem }
  /** Пришло не то — это надо показать, а не упасть. */
  | { kind: "unknown"; reason: string };

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/**
 * Какой должна быть форма данных, решает вид, а не источник. Несовпадение — ошибка на метрике, а
 * не сломанная панель (решение 0004).
 */
export function toShape(kind: string | undefined, data: unknown): Shape {
  const record = asRecord(data);
  switch (kind) {
    case "text":
    case "markdown":
      return typeof record.text === "string"
        ? { kind, text: record.text }
        : { kind: "unknown", reason: "ждём { text }" };
    case "link":
      return typeof record.link === "string" || typeof record.label === "string"
        ? { kind: "link", item: record as LinkItem }
        : { kind: "unknown", reason: "ждём { label, link }" };
    case "status":
      return typeof record.ok === "boolean"
        ? { kind: "status", ok: record.ok, summary: record.summary as string | undefined }
        : { kind: "unknown", reason: "ждём { ok, summary }" };
    case "list":
      return Array.isArray(record.items)
        ? { kind: "list", items: record.items as LinkItem[] }
        : { kind: "unknown", reason: "ждём { items }" };
    case "tree":
      return Array.isArray(record.children)
        ? { kind: "tree", children: record.children as TreeItem[] }
        : { kind: "unknown", reason: "ждём { children }" };
    case "object":
      return typeof record.object === "string"
        ? { kind: "object", item: record as CardItem }
        : { kind: "unknown", reason: "ждём { object }" };
    default:
      return { kind: "unknown", reason: `вид ${kind ?? "не задан"}` };
  }
}

/**
 * Пусто — это ответ, а не ошибка (решение 0010): «не собиралась», если данных нет вовсе, и «нет
 * таких» у пустого списка. Метрика говорит это своими словами через `empty`.
 */
export function placeholder(
  shape: Shape,
  data: unknown,
  empty: string | undefined,
): string | undefined {
  if (data === undefined) return empty ?? "не собиралась";
  if (shape.kind === "list" && shape.items.length === 0) return empty ?? "нет таких";
  if (shape.kind === "tree" && shape.children.length === 0) return empty ?? "нет таких";
  return undefined;
}
