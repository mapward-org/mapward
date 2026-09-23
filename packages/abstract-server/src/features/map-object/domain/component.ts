import Schema from "typebox/schema";
import { ACTION_REF, actionRefSchema } from "@mapward/core";
import type { MetricConfig } from "@mapward/core";
import { dirname, join } from "../../../lib/path.ts";

/**
 * Дисплей-компонент метрики — решение 0037: то, что про него можно сказать без среды.
 */

const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/**
 * Пути компонента и схемы считаются от папки того `config.json`, где они написаны, а не от
 * наследника: компонент прототипа лежит у прототипа, и наследник с одной строкой `extends`
 * должен его находить. После мерджа слой уже не виден, поэтому путь делается абсолютным
 * сразу, как слой прочитан.
 */
export function anchorDisplay(config: MetricConfig, configPath: string): MetricConfig {
  const display = config.display;
  if (!display) return config;
  const dir = dirname(configPath);
  const anchor = (path: string) =>
    isAbsolute(path.replaceAll("\\", "/")) ? path.replaceAll("\\", "/") : join(dir, path);

  return {
    ...config,
    display: {
      ...display,
      ...(display.component === undefined ? {} : { component: anchor(display.component) }),
      ...(typeof display.schema === "string" ? { schema: anchor(display.schema) } : {}),
    },
  };
}

/**
 * Что данные не прошли схему — строкой на поле: путь до него и что ожидалось. Это и есть
 * текст, по которому человек и агент чинят трансформ, поэтому путь идёт первым.
 */
export function schemaErrors(schema: unknown, data: unknown): string[] {
  try {
    const [ok, errors] = Schema.Errors(knownRefs(schema) as Schema.XSchema, data);
    if (ok) return [];
    return errors.map((error) => `${error.instancePath || "/"}: ${error.message}`);
  } catch (error) {
    return [`схема не читается: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/**
 * `{ "$ref": "mapward:action" }` — экшон строки (решение 0038). Валидатор такого адреса не
 * знает, поэтому перед проверкой и перед промптом на его место встаёт сама форма.
 */
export function knownRefs(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(knownRefs);
  if (typeof schema !== "object" || schema === null) return schema;
  const node = schema as Record<string, unknown>;
  if (node.$ref === ACTION_REF) return actionRefSchema;
  return Object.fromEntries(Object.entries(node).map(([name, value]) => [name, knownRefs(value)]));
}

/**
 * Кандидаты в классы tailwind из текста файла. Сканера tailwind здесь нет — он нативный, а
 * расширение едет без `node_modules` (решение 0037). Поэтому берётся всё, что похоже на
 * слово без кавычек и пробелов: лишнее tailwind отбросит сам и css на него не напишет.
 */
export function candidates(text: string): string[] {
  return text.split(/[\s"'`{}<>;,=\\]+/).filter((token) => token.length > 0 && token.length < 200);
}

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};

const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

/**
 * Тип TypeScript по JSON-схеме — для `DisplayProps<Data>` (решение 0037). JSON в TypeScript не
 * импортируется с точными типами, поэтому тип пишется рядом с компонентом файлом.
 *
 * Разбирается то, что пишут в схемах данных: объекты, массивы, примитивы, `enum`, `const`,
 * `anyOf`/`oneOf`/`allOf`, и `mapward:action` — тип экшона строки. Чего не понял — `unknown`:
 * неточный тип лучше выдуманного.
 */
export function schemaType(schema: unknown, indent = ""): string {
  if (schema === true || schema === undefined) return "unknown";
  if (schema === false) return "never";
  const node = record(schema);

  if (node.$ref === ACTION_REF) return "ActionRef";
  if ("const" in node) return JSON.stringify(node.const);
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
  for (const [field, glue] of [
    ["anyOf", " | "],
    ["oneOf", " | "],
    ["allOf", " & "],
  ] as const) {
    const parts = node[field];
    if (Array.isArray(parts)) {
      return parts.map((part) => `(${schemaType(part, indent)})`).join(glue);
    }
  }

  const type = node.type;
  if (Array.isArray(type)) {
    return type.map((one) => schemaType({ ...node, type: one }, indent)).join(" | ");
  }

  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const items = schemaType(node.items, indent);
      return /^[\w.]+$/.test(items) ? `${items}[]` : `Array<${items}>`;
    }
    case "object":
      return objectType(node, indent);
    default:
      return "properties" in node ? objectType(node, indent) : "unknown";
  }
}

function objectType(node: Json, indent: string): string {
  const inner = `${indent}  `;
  const required = new Set(Array.isArray(node.required) ? node.required.map(String) : []);
  const lines = Object.entries(record(node.properties)).map(
    ([name, property]) =>
      `${inner}${key(name)}${required.has(name) ? "" : "?"}: ${schemaType(property, inner)};`,
  );
  const rest = node.additionalProperties;
  if (rest !== undefined && rest !== false) {
    lines.push(`${inner}[key: string]: ${rest === true ? "unknown" : schemaType(rest, inner)};`);
  }
  if (lines.length === 0) return rest === false ? "{}" : "Record<string, unknown>";
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/** Файл, который `mapward display check` кладёт рядом с компонентом. */
export function dataDeclaration(schema: unknown): string {
  const type = schemaType(schema);
  // Тип экшона берётся из пакета, а не пишется заново: тогда строка уходит в `List` как есть.
  const imports = /\bActionRef\b/.test(type)
    ? 'import type { ActionRef } from "@mapward/display";\n'
    : "";
  return (
    "// Написано `mapward display check` по схеме метрики — руками не править.\n" +
    imports +
    `export type Data = ${type};\n`
  );
}
