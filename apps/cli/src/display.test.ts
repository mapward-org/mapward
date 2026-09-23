import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createMapServer } from "@mapward/abstract-server";
import { createPorts } from "./ports.ts";

/**
 * Дисплей-компонент целиком — решение 0037: сборка настоящим esbuild в WebAssembly, стили
 * настоящим tailwind, схема настоящим валидатором. Живёт в cli, потому что `.wasm` читает node,
 * а пакетам node не положен.
 */

let root = "";
const slash = (path: string) => path.replaceAll("\\", "/");

const files: Record<string, string> = {
  "map/_index.json": JSON.stringify({ name: "Корень" }),
  "map/_metrics/tx/config.json": JSON.stringify({
    label: "Транскрибация",
    collectors: [{ kind: "static", value: { items: [{ label: "урок 1", done: "да" }] } }],
    display: { kind: "component", component: "./display.tsx", schema: "./schema.json" },
  }),
  "map/_metrics/tx/schema.json": JSON.stringify({
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "done"],
          properties: { label: { type: "string" }, done: { type: "boolean" } },
        },
      },
    },
  }),
  "map/_metrics/tx/display.tsx": [
    'import { List } from "@mapward/display";',
    'import { title } from "./title.ts";',
    'import { shout } from "tiny";',
    "export default function Display(props: { data: { items: { label: string }[] } }) {",
    '  return <div className="p-2 text-[var(--mw-foreground)]">{shout(title)}<List items={props.data.items} /></div>;',
    "}",
  ].join("\n"),
  "map/_metrics/tx/title.ts": 'export const title: string = "записи";',
  "node_modules/tiny/package.json": JSON.stringify({
    name: "tiny",
    exports: { ".": { import: "./index.mjs", require: "./index.cjs" } },
  }),
  "node_modules/tiny/index.mjs": "export const shout = (text) => text.toUpperCase();",
  "map/_metrics/broken/config.json": JSON.stringify({
    display: { kind: "component", component: "./display.tsx" },
  }),
  "map/_metrics/broken/display.tsx":
    'import { nope } from "missing-package";\nexport default nope;',
};

beforeAll(async () => {
  root = slash(await mkdtemp(join(tmpdir(), "mapward-display-")));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const ref = () => ({ mapPath: `${root}/map`, basePath: root, name: "test" });

test("компонент собирается: свой файл и пакет внутри, react и набор снаружи, css на его классы", async () => {
  const server = createMapServer(createPorts());
  const build = await server.buildDisplay({ ...ref(), metric: "mapward://_metrics/tx" });

  expect(build.errors).toBeUndefined();
  expect(build.code).toContain('require("react/jsx-runtime")');
  expect(build.code).toContain('require("@mapward/display")');
  expect(build.code).toContain("записи");
  expect(build.code).toContain("toUpperCase");
  expect(build.css).toContain(".p-2");
  expect(build.css).toContain("color: var(--mw-foreground)");
  // Без сброса стилей: компонент не перекрашивает карту.
  expect(build.css).not.toContain("box-sizing: border-box");
}, 30_000);

test("пакет не найден — ошибка сборки с файлом и тем, где искали", async () => {
  const server = createMapServer(createPorts());
  const build = await server.buildDisplay({ ...ref(), metric: "mapward://_metrics/broken" });

  expect(build.code).toBeUndefined();
  expect(build.errors?.[0]).toMatch(/display\.tsx:1:\d+: не найден пакет missing-package/);
}, 30_000);

test("данные не прошли схему — метрика красная, в ошибке путь до поля", async () => {
  const server = createMapServer(createPorts());
  const value = await server.runMetric({ ...ref(), metric: "mapward://_metrics/tx" });

  expect(value.ok).toBe(false);
  expect(value.invalid).toEqual([expect.stringMatching(/^\/items\/0\/done: /)]);
});
