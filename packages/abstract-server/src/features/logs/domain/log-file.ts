import type { LogFilter, LogLine } from "@mapward/core";

/** Папка логов в корне карты: `.`-папка в модель не попадает, в git — тоже (`.gitignore` со `*`). */
export const LOGS_DIR = ".mapward/logs";

/** Предел файла: дальше он становится `.1`, а прежний `.1` уходит. Логи смотрят по свежему. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Сколько строк файла держать в памяти: хватает на экран и хвост причины падения. */
export const KEEP_LINES = 5_000;

/**
 * Имя файла плагина — имя его папки: `_plugins/shell` пишет в `shell.log`. Чужие знаки уходят:
 * имя становится частью пути.
 */
export function logFileOf(plugin: string): string {
  const name = plugin.replaceAll("\\", "/").replace(/\/+$/, "").split("/").pop() ?? "";
  const safe = name.replaceAll(/[^\p{L}\p{N}._-]/gu, "_");
  return safe === "" ? "plugin" : safe;
}

export const logPath = (mapPath: string, file: string, rotated = false): string =>
  `${mapPath.replaceAll("\\", "/").replace(/\/+$/, "")}/${LOGS_DIR}/${file}.log${rotated ? ".1" : ""}`;

/** Имя файла по имени на диске: `shell.log` и `shell.log.1` — один файл `shell`. */
export function fileOfName(name: string): string | undefined {
  const match = /^(.+)\.log(\.1)?$/.exec(name);
  return match?.[1];
}

/** Строки файла: битая строка (недописанная при падении) пропускается, а не роняет чтение. */
export function parseLines(text: string, file: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed) as LogLine;
      if (typeof parsed === "object" && parsed !== null && typeof parsed.kind === "string") {
        lines.push({ ...parsed, file });
      }
    } catch {
      // недописанная строка
    }
  }
  return lines;
}

/** Строка на диск: `file` в ней лишний — он и есть имя файла. */
export function serialize(line: LogLine): string {
  const { file: _file, ...rest } = line;
  return `${JSON.stringify(rest)}\n`;
}

export function matches(line: LogLine, filter: LogFilter): boolean {
  if (filter.file !== undefined && line.file !== filter.file) return false;
  if (filter.trace !== undefined && line.trace !== filter.trace) return false;
  if (filter.object !== undefined && line.object !== filter.object) return false;
  return true;
}

/** Строки нескольких файлов по времени; равные по времени — в порядке записи. */
export function byTime(lines: LogLine[]): LogLine[] {
  return lines
    .map((line, index) => ({ line, index }))
    .toSorted((a, b) => a.line.at.localeCompare(b.line.at) || a.index - b.index)
    .map((entry) => entry.line);
}
