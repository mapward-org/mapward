import { readField } from "@mapward/core";
import type { MapRef } from "../../../kernel/map-ref.ts";
import { flag, frontmatter } from "../../../lib/frontmatter.ts";
import { join, normalize, slash } from "../../../lib/path.ts";
import { schemaErrors } from "../../../lib/schema-errors.ts";
import { inside } from "./steps.ts";

/**
 * Свои поля карты в словах платформы — чистые функции над текстами: этап в frontmatter и обратно,
 * пути с подстановками, ошибки схемы без подстановок. Читает и пишет `FieldOps`.
 */

/** Этап воркфлоу, каким его отдаёт `get` и берёт `set`. */
export type StageContent = { name: string; order: number; marksDone: boolean; text: string };

export const StageSchema = {
  type: "object",
  required: ["name", "order", "text"],
  properties: {
    name: { type: "string", minLength: 1 },
    order: { type: "number" },
    marksDone: { type: "boolean" },
    text: { type: "string" },
  },
  additionalProperties: false,
} as const;

/** Этап из файла: тело без пустой строки после frontmatter — её добавляет запись. */
export function readStage(fallback: string, text: string): StageContent {
  const { fields, body } = frontmatter(text);
  const order = Number(fields.order);
  return {
    name: fields.name ?? fallback,
    order: Number.isFinite(order) ? order : 0,
    marksDone: flag(fields["marks-done"]),
    text: body.replace(/^\r?\n/, ""),
  };
}

/** Этап в файл — тем видом, что у соседних: ключи по-своему, `marks-done` только когда ставит. */
export function writeStage(stage: StageContent): string {
  const head = [
    "---",
    `name: ${stage.name.replaceAll(/\r?\n/g, " ")}`,
    `order: ${String(stage.order)}`,
    ...(stage.marksDone ? ["marks-done: true"] : []),
    "---",
  ];
  const body = stage.text.endsWith("\n") ? stage.text : `${stage.text}\n`;
  return `${head.join("\n")}\n\n${body}`;
}

const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/**
 * Куда ведёт путь из конфига: подстановки корней (`${{ mapward:// }}`, `${{ mapward://@ }}`)
 * раскрываются, адрес `mapward://…` — папка карты, относительный — от `dir`. Путь с другой
 * подстановкой (`${{ mapward://~#props.path }}`) известен только объекту — `undefined`: такой не
 * проверить.
 */
export function resolvePath(raw: string, dir: string, ref: MapRef): string | undefined {
  const text = slash(raw.trim())
    .replaceAll(/\$\{\{\s*mapward:\/\/@\s*\}\}/g, slash(ref.basePath))
    .replaceAll(/\$\{\{\s*mapward:\/\/\s*\}\}/g, slash(ref.mapPath));
  if (text.includes("${{")) return undefined;
  if (text.startsWith("mapward://")) {
    const body = text.slice("mapward://".length);
    if (body.includes("#") || body.startsWith("~")) return undefined;
    if (body === "@" || body.startsWith("@/")) return join(ref.basePath, body.slice(1));
    return join(ref.mapPath, body);
  }
  return isAbsolute(text) ? normalize(text) : join(dir, text);
}

/**
 * Путь в конфиг: внутри карты — подстановкой от её корня, чтобы конфиг не ломался, когда карту
 * переносят; вне карты — как есть.
 */
export function configPath(path: string, ref: MapRef): string {
  const mapPath = slash(ref.mapPath);
  return inside(path, mapPath) ? `\${{ mapward:// }}${path.slice(mapPath.length)}` : path;
}

/** Путь в инструкции к полю: `/params/source` → `["params", "source"]`. */
const pointer = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .map((step) => step.replaceAll("~1", "/").replaceAll("~0", "~"));

/**
 * Ошибки схемы, кроме полей с подстановкой: её значение известно только объекту, и
 * `"${{ mapward://~#props.size }}"` на месте числа — не ошибка автора. Пути — с приставкой
 * `prefix`, чтобы агент видел поле от корня своего файла.
 */
export function fieldErrors(schema: unknown, data: unknown, prefix = ""): string[] {
  return schemaErrors(schema, data).flatMap((line) => {
    const at = line.indexOf(": ");
    const path = at === -1 ? "/" : line.slice(0, at);
    const value = path === "/" ? data : readField(data, pointer(path));
    if (typeof value === "string" && value.includes("${{")) return [];
    return [`${prefix}${path === "/" && prefix ? "" : path}${line.slice(at)}`];
  });
}

/** Схема параметров без `required` верхнего уровня: остальное экшону добирает форма. */
export function partial(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return schema;
  const { required: _required, ...rest } = schema as Record<string, unknown>;
  return rest;
}

/**
 * Чьё это хозяйство: `.mapward/` — локальное платформы (корзина, сборки, прогоны),
 * `_directives.state/` — состояние прогонов директив. Их пишет только платформа.
 */
export function owned(path: string, mapPath: string): boolean {
  const rest = path.slice(slash(mapPath).length).split("/").filter(Boolean);
  return rest[0] === ".mapward" || rest.includes("_directives.state");
}

/** Путь сырого файла: от папки карты или абсолютный внутри неё. */
export function filePath(given: string, mapPath: string): string | { error: string } {
  const raw = slash(given.trim());
  if (!raw) return { error: "Пустой путь" };
  const path = isAbsolute(raw) ? normalize(raw) : join(mapPath, raw);
  if (!inside(path, slash(mapPath)) || path === slash(mapPath)) {
    return { error: `${given} — не внутри папки карты ${mapPath}` };
  }
  if (owned(path, mapPath)) {
    return {
      error: `${given} — хозяйство платформы (.mapward/, _directives.state/): его пишет только она`,
    };
  }
  return path;
}

/** Обычный объект JSON — не массив и не `null`. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
