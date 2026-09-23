import type {
  ActionRef,
  DisplayShape,
  GitLetter,
  GitMark,
  LinkNode,
  MapRelation,
  StatusMark,
  TreeNode,
} from "@mapward/core";
import { linkKind } from "@mapward/core";

/**
 * Формы приходят из `core` — они общие с сервером (решение 0014). Здесь только то, что делает
 * с ними клиент: разбор пришедшего и цвета статусов.
 */
export type { ActionRef, GitLetter, GitMark, LinkNode, MapRelation, StatusMark, TreeNode };

/**
 * К формам из `core` клиент добавляет свой случай: пришло не то, и это надо показать. Формы
 * не переписываются — иначе расхождение с сервером поймает человек, а не компилятор.
 */
export type DisplayData = DisplayShape | { kind: "unknown"; reason: string };

/** Editor colours, so a status reads the same as the rest of the interface in any theme. */
const KNOWN: Record<string, string> = {
  success: "var(--mw-testing-iconPassed, #3fb950)",
  fail: "var(--mw-testing-iconFailed, #f85149)",
  pending: "var(--mw-testing-iconQueued, #d29922)",
  idle: "var(--mw-descriptionForeground, #8b949e)",
};

/** An unknown status is still shown — in the neutral colour, with its name in the tooltip. */
export function statusColor(mark: StatusMark): string | undefined {
  if (mark.color) return mark.color;
  if (!mark.status) return undefined;
  return KNOWN[mark.status] ?? KNOWN.idle;
}

export const statusHint = (mark: StatusMark): string | undefined => mark.hint ?? mark.status;

/**
 * Цвета git — те же, что в проводнике редактора: пометка переносится из него, и читаться должна
 * так же (решение 0023). Буква рядом с цветом, потому что цвет один язык, а буква другой:
 * дальтонику и в чёрно-белой теме остаётся буква.
 */
const GIT_COLOR: Record<GitLetter, string> = {
  M: "var(--mw-gitDecoration-modifiedResourceForeground, #e2c08d)",
  A: "var(--mw-gitDecoration-addedResourceForeground, #81b88b)",
  D: "var(--mw-gitDecoration-deletedResourceForeground, #c74e39)",
  U: "var(--mw-gitDecoration-untrackedResourceForeground, #73c991)",
  C: "var(--mw-gitDecoration-conflictingResourceForeground, #e4676b)",
};

const GIT_HINT: Record<GitLetter, string> = {
  M: "изменён",
  A: "добавлен",
  D: "удалён",
  U: "не отслеживается",
  C: "конфликт",
};

export const gitColor = (mark: GitMark): string | undefined =>
  mark.git ? GIT_COLOR[mark.git] : undefined;

export const gitHint = (mark: GitMark): string | undefined =>
  mark.git ? GIT_HINT[mark.git] : undefined;

/**
 * Табом открывается объект, а не файл и не страница наружу — решение 0026. Куда ведёт ссылка,
 * по-прежнему решает схема (0005), поэтому и здесь спрашивается она, а не вид дисплея.
 */
export const isObjectLink = (link: string | undefined): link is string =>
  link !== undefined && linkKind(link) === "object";

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
    // Форма та же, что у `text`: дисплей меняет вид текста, а не его устройство (решение 0027).
    case "markdown":
      return typeof record.text === "string"
        ? { kind: "markdown", text: record.text }
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
    // Форму компонента проверяет его схема на сервере (решение 0037): здесь данные идут как есть.
    case "component":
      return { kind: "component", data };
    default:
      return { kind: "unknown", reason: `дисплей ${kind ?? "не задан"}` };
  }
}

/**
 * Nothing to show is an answer, not a failure — decision 0010. A metric that has not run yet
 * used to read as «данные не той формы», which blamed the config for a run that never happened.
 * The metric may say it in its own words through `display.empty`.
 *
 * Ответа ещё нет — третье состояние, а не «не собиралась» (решение 0041): снимок не пришёл или
 * сервер ещё поднимает собранное с диска. Сказать тут «не собиралась» значило бы соврать про
 * метрику, у которой значение есть.
 */
export function placeholder(
  data: DisplayData,
  collected: boolean,
  empty: string | undefined,
  pending = false,
): string | undefined {
  if (pending) return "загружается…";
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
