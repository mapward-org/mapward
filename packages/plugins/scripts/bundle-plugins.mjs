import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Встроенный плагин ставится в карту копией исходников, а установленное расширение — один бандл
 * без `node_modules`: путей до `registry/` в нём нет. Поэтому исходники едут внутри сервера
 * строками, как доки, — модуль собирается перед сборкой и в гит не кладётся: две копии одного
 * текста разъезжаются.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = path.join(root, "registry");

/** Сборок, зависимостей и тестов в карту не везём: копируется только код плагина. */
const SKIP = new Set(["node_modules", "dist", ".turbo"]);
const skipFile = (name) => /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts");

async function collect(dir, prefix = "") {
  const files = {};
  const entries = (await readdir(dir, { withFileTypes: true })).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(files, await collect(path.join(dir, entry.name), relative));
    } else if (!skipFile(entry.name)) {
      files[relative] = await readFile(path.join(dir, entry.name), "utf8");
    }
  }
  return files;
}

const names = (await readdir(registry, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const plugins = {};
for (const name of names) {
  const files = await collect(path.join(registry, name));
  if (!files["index.ts"] && !files["index.tsx"]) {
    throw new Error(`встроенный плагин ${name}: нет index.ts`);
  }
  plugins[name] = files;
}

const body = `// Собрано scripts/bundle-plugins.mjs из registry/. Не править руками.
export const SOURCES: Record<string, Record<string, string>> = ${JSON.stringify(plugins, null, 2)};
`;

await writeFile(path.join(root, "src", "sources.generated.ts"), body, "utf8");
console.log(`plugins: собрано ${names.join(", ")}`);
