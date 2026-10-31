import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BuildComponent } from "@mapward/abstract-server";

/**
 * Сборку компонента можно не повторять, только если файлы ответили бы сборщику то же самое:
 * прочитанное, промахи и пакеты. Здесь — настоящий сборщик карты и настоящие файлы.
 */

const slash = (path: string) => path.replaceAll("\\", "/");
const repo = slash(join(dirname(fileURLToPath(import.meta.url)), "../../../../.."));
const require = createRequire(import.meta.url);

const builder = new BuildComponent(
  {
    read: (path) => readFile(path, "utf8").catch(() => undefined),
    list: async (path) =>
      (await readdir(path, { withFileTypes: true }).catch(() => [])).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
    stat: (path) =>
      stat(path).then(
        ({ size, mtimeMs }) => ({ size, mtimeMs }),
        () => undefined,
      ),
    realpath: (path) => realpath(path).catch(() => undefined),
  },
  { now: () => "now" },
  {
    wasm: () =>
      readFile(join(dirname(require.resolve("esbuild-wasm/package.json")), "esbuild.wasm")),
  },
);

let scratch = "";

beforeAll(async () => {
  scratch = slash(await mkdtemp(join(tmpdir(), "mapward-inputs-")));
  await writeFile(`${scratch}/dep.ts`, 'export const word = "раз";\n', "utf8");
  await writeFile(
    `${scratch}/view.tsx`,
    [
      'import { map } from "rxjs";',
      'import { word } from "./dep";',
      "export default function View() {",
      "  return <b>{word}{String(typeof map)}</b>;",
      "}",
    ].join("\n"),
    "utf8",
  );
});

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

const run = () => builder.run({ entry: `${scratch}/view.tsx`, basePath: repo });

test("входы сборки — прочитанное и промахи; пока они те же, сборка свежая", async () => {
  const built = await run();
  expect(built.build.errors).toBeUndefined();
  const inputs = built.inputs!;
  // Промах тоже вход: `./dep` искался как `.tsx` раньше, чем нашёлся `.ts`.
  expect(inputs.reads[`${scratch}/dep.tsx`]).toBeNull();
  expect(typeof inputs.reads[`${scratch}/dep.ts`]).toBe("string");
  expect(await builder.fresh(inputs)).toBe(true);
}, 60_000);

test("правка импортированного файла — сборка не свежая", async () => {
  const { inputs } = await run();
  await writeFile(`${scratch}/dep.ts`, 'export const word = "два";\n', "utf8");
  expect(await builder.fresh(inputs!)).toBe(false);
}, 60_000);

test("новый файл, который сборщик нашёл бы раньше, — сборка не свежая", async () => {
  const { inputs } = await run();
  await writeFile(`${scratch}/dep.tsx`, 'export const word = "три";\n', "utf8");
  expect(await builder.fresh(inputs!)).toBe(false);
  await rm(`${scratch}/dep.tsx`);
  expect(await builder.fresh(inputs!)).toBe(true);
}, 60_000);
