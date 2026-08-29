/** Shapes each display expects — decision 0004. */
export type LinkNode = { label?: string; link?: string };
export type TreeNode = { label?: string; link?: string; children?: TreeNode[] };

export type DisplayData =
  | { kind: "text"; text: string }
  | { kind: "link"; node: LinkNode }
  | { kind: "status"; ok: boolean; summary?: string }
  | { kind: "list"; items: LinkNode[] }
  | { kind: "tree"; children: TreeNode[] }
  | { kind: "unknown"; reason: string };

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/**
 * The display, not the collector, decides what the data must look like. A mismatch is shown
 * as an error on the metric instead of breaking the sidebar — decision 0004.
 */
export function toDisplay(kind: string | undefined, data: unknown): DisplayData {
  const record = asRecord(data);

  switch (kind) {
    case "text":
      return typeof record.text === "string"
        ? { kind: "text", text: record.text }
        : { kind: "unknown", reason: "ждём { text }" };
    case "link":
      return typeof record.link === "string" || typeof record.label === "string"
        ? { kind: "link", node: record as LinkNode }
        : { kind: "unknown", reason: "ждём { label, link }" };
    case "status":
      return typeof record.ok === "boolean"
        ? { kind: "status", ok: record.ok, summary: record.summary as string | undefined }
        : { kind: "unknown", reason: "ждём { ok, summary }" };
    case "list":
      return Array.isArray(record.items)
        ? { kind: "list", items: record.items as LinkNode[] }
        : { kind: "unknown", reason: "ждём { items }" };
    case "tree":
      return Array.isArray(record.children)
        ? { kind: "tree", children: record.children as TreeNode[] }
        : { kind: "unknown", reason: "ждём { children }" };
    default:
      return { kind: "unknown", reason: `дисплей ${kind ?? "не задан"}` };
  }
}

/** «5 минут назад» rather than a timestamp: freshness is what the eye needs here. */
export function ago(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined;
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} д назад`;
}
