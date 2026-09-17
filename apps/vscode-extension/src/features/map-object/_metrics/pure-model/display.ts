/** Shapes each display expects — decisions 0004 and 0010. */

/**
 * Four states carry their own colour, and that covers most of what a list has to say: a run
 * passed or failed, work is queued or has not started. Anything else names its own `color`
 * and explains itself in `hint` — decision 0010.
 */
export type StatusMark = { status?: string; color?: string; hint?: string };

/** `description` is the second line: where a check says what exactly went wrong — decision 0010. */
export type LinkNode = StatusMark & { label?: string; link?: string; description?: string };
export type TreeNode = StatusMark & {
  label?: string;
  link?: string;
  description?: string;
  isDir?: boolean;
  children?: TreeNode[];
};
export type MapRelation = { label?: string; link?: string; from?: string; to?: string };

export type DisplayData =
  | { kind: "text"; text: string }
  | { kind: "link"; node: LinkNode }
  | { kind: "status"; ok: boolean; summary?: string }
  | { kind: "list"; items: LinkNode[] }
  | { kind: "tree"; children: TreeNode[] }
  | { kind: "map"; nodes: LinkNode[]; relations: MapRelation[] }
  | { kind: "unknown"; reason: string };

/** Editor colours, so a status reads the same as the rest of the interface in any theme. */
const KNOWN: Record<string, string> = {
  success: "var(--vscode-testing-iconPassed, #3fb950)",
  fail: "var(--vscode-testing-iconFailed, #f85149)",
  pending: "var(--vscode-testing-iconQueued, #d29922)",
  idle: "var(--vscode-descriptionForeground, #8b949e)",
};

/** An unknown status is still shown — in the neutral colour, with its name in the tooltip. */
export function statusColor(mark: StatusMark): string | undefined {
  if (mark.color) return mark.color;
  if (!mark.status) return undefined;
  return KNOWN[mark.status] ?? KNOWN.idle;
}

export const statusHint = (mark: StatusMark): string | undefined => mark.hint ?? mark.status;

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
    case "map":
      return Array.isArray(record.nodes)
        ? {
            kind: "map",
            nodes: record.nodes as LinkNode[],
            relations: (record.relations ?? []) as MapRelation[],
          }
        : { kind: "unknown", reason: "ждём { nodes, relations }" };
    default:
      return { kind: "unknown", reason: `дисплей ${kind ?? "не задан"}` };
  }
}

/**
 * Nothing to show is an answer, not a failure — decision 0010. A metric that has not run yet
 * used to read as «данные не той формы», which blamed the config for a run that never happened.
 * The metric may say it in its own words through `display.empty`.
 */
export function placeholder(
  data: DisplayData,
  collected: boolean,
  empty: string | undefined,
): string | undefined {
  if (!collected) return empty ?? "не собиралась";
  if (data.kind === "list" && data.items.length === 0) return empty ?? "нет таких";
  if (data.kind === "tree" && data.children.length === 0) return empty ?? "нет таких";
  return undefined;
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
