import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * `core` — связка: то, что двум сторонам нужно одинаково (`ru/docs/architecture/core.md`). Модель
 * карты собирает только сервер, и всё, что нужно ему одному, живёт у него. «Положу в core, раз
 * общее» в диффе выглядит безобидно — поэтому у каждого модуля `core` должен быть потребитель
 * кроме сервера: клиент, расширение, cli, `@mapward/plugin`, `@mapward/component`, встроенные
 * плагины. Считается прямой импорт из `@mapward/core` в коде (тесты не в счёт: тест — не сторона).
 */
const CORE = "packages/core/src";

/** Модули, у которых своего потребителя вне сервера нет, — и почему им всё равно место здесь. */
const EXCEPTIONS: Record<string, string> = {
  // Часть `appBridge`: клиент и хост знают мост целиком, а не его куски поштучно.
  "contracts/state.ts": "кусок appBridge — едет в контракт моста целиком",
};

/** Где живут стороны, кроме сервера. */
const CONSUMERS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "dist", ".turbo", "core", "abstract-server"]);

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : sources(full);
      const code = /\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name);
      return Promise.resolve(code ? [full] : []);
    }),
  );
  return nested.flat();
}

/** Имена, которые модуль отдаёт: объявления с `export` и `export { … }` без `from`. */
function exportedNames(text: string): string[] {
  const declared = [
    ...text.matchAll(
      /^export\s+(?:declare\s+)?(?:const|let|function|class|type|interface)\s+(\w+)/gm,
    ),
  ].map((match) => match[1] as string);
  const listed = [...text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*;/gm)].flatMap((match) =>
    (match[1] as string).split(","),
  );
  return [
    ...declared,
    ...listed.map(
      (name) =>
        name
          .trim()
          .split(/\s+as\s+/)
          .at(-1) ?? "",
    ),
  ].filter(Boolean);
}

/** Имена, взятые из `@mapward/core` импортом или реэкспортом. */
function importedNames(text: string): string[] {
  return [
    ...text.matchAll(
      /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@mapward\/core["']/g,
    ),
  ].flatMap((match) =>
    (match[1] as string)
      .split(",")
      .map(
        (name) =>
          name
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0] ?? "",
      )
      .filter(Boolean),
  );
}

test("у каждого модуля core есть потребитель кроме сервера", async () => {
  const modules = (await sources(CORE))
    .map((file) => path.relative(CORE, file).replaceAll("\\", "/"))
    .filter((file) => file !== "index.ts");
  expect(modules.length).toBeGreaterThan(0);

  const owner = new Map<string, string>();
  for (const module of modules) {
    // oxlint-disable-next-line no-await-in-loop
    for (const name of exportedNames(await readFile(path.join(CORE, module), "utf8"))) {
      owner.set(name, module);
    }
  }

  const used = new Set<string>();
  const files = (await Promise.all(CONSUMERS.map((dir) => sources(dir)))).flat();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    for (const name of importedNames(await readFile(file, "utf8"))) {
      const module = owner.get(name);
      if (module) used.add(module);
    }
  }

  const unused = modules.filter((module) => !used.has(module) && !(module in EXCEPTIONS));
  expect(unused, "этим модулям core место у сервера — или запишите исключение с причиной").toEqual(
    [],
  );
  // Исключение, у которого появился потребитель, больше не исключение.
  expect(Object.keys(EXCEPTIONS).filter((module) => used.has(module))).toEqual([]);
});
