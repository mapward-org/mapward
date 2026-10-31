import type { OpenHow } from "@mapward/component";
import type { GitLetter, LinkItem } from "./types.ts";

/**
 * Пометки строки — точка статуса, буква git, иконка файла — и то, как строка открывается. Цвета —
 * переменными темы редактора `--mw-*`: статус читается так же, как остальной интерфейс.
 */

const STATUS: Record<string, string> = {
  success: "var(--mw-testing-iconPassed, #3fb950)",
  fail: "var(--mw-testing-iconFailed, #f85149)",
  pending: "var(--mw-testing-iconQueued, #d29922)",
  idle: "var(--mw-descriptionForeground, #8b949e)",
};

type StatusMark = Pick<LinkItem, "status" | "color" | "hint">;

/** Незнакомый статус всё равно виден — нейтральным цветом, с именем в подсказке. */
export function statusColor(mark: StatusMark): string | undefined {
  if (mark.color) return mark.color;
  if (!mark.status) return undefined;
  return STATUS[mark.status] ?? STATUS.idle;
}

export const statusHint = (mark: StatusMark): string | undefined => mark.hint ?? mark.status;

/**
 * Цвета git — те же, что в проводнике редактора: пометка переносится из него. Буква рядом с
 * цветом: дальтонику и в чёрно-белой теме остаётся буква.
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

export const gitColor = (mark: { git?: GitLetter }): string | undefined =>
  mark.git ? GIT_COLOR[mark.git] : undefined;

export const gitHint = (mark: { git?: GitLetter }): string | undefined =>
  mark.git ? GIT_HINT[mark.git] : undefined;

/** Ссылка на объект карты — её можно открыть отдельным табом. */
export const isObjectLink = (link: string | undefined): link is string =>
  link?.startsWith("mapward://") === true;

/**
 * Как открыть по клику: ctrl + клик по ссылке на объект — табом. Хост без табов откроет такую
 * ссылку обычным переходом.
 */
export const openHow = (link: string, event: { ctrlKey: boolean; metaKey: boolean }): OpenHow => ({
  tab: isObjectLink(link) && (event.ctrlKey || event.metaKey),
});

export const TAB_TITLE = "Ctrl + клик — открыть отдельным табом";

/**
 * Подсветка ссылки под ctrl (атрибут `data-tab-mod` ставит карта): ссылка на объект подчёркнута
 * всегда и под ctrl получает руку, остальные под ctrl подчёркивание теряют. Строки целиком, а не
 * склейкой: tailwind находит классы по тексту исходника.
 */
export const linkHover = (link: string) =>
  isObjectLink(link)
    ? "hover:underline in-data-[tab-mod]:hover:cursor-pointer"
    : "not-in-data-[tab-mod]:hover:underline";

/**
 * Иконка файла — codicon редактора по расширению: тема иконок файлов, которую выбрал человек,
 * вебвью недоступна.
 */
const BY_EXTENSION: Record<string, string> = {
  json: "json",
  md: "markdown",
  ts: "file-code",
  tsx: "file-code",
  js: "file-code",
  mjs: "file-code",
  cjs: "file-code",
  css: "symbol-color",
  html: "code",
  yml: "settings",
  yaml: "settings",
  toml: "settings",
  lock: "lock",
  png: "file-media",
  jpg: "file-media",
  jpeg: "file-media",
  svg: "file-media",
  gif: "file-media",
  ttf: "text-size",
  sh: "terminal",
};

const BY_NAME: Record<string, string> = {
  "package.json": "package",
  "pnpm-lock.yaml": "lock",
  "mapward.json": "map",
  ".gitignore": "source-control",
  "readme.md": "book",
};

export function fileIcon(name: string, folder: boolean): string {
  if (folder) return "folder";
  const byName = BY_NAME[name.toLowerCase()];
  if (byName) return byName;
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? "file";
}
