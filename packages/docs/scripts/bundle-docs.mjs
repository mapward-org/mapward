import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Доки ехать файлами не могут: расширение собирается одним бандлом, и пути до `.md` в нём не
 * переживают сборку. Поэтому markdown остаётся источником, а рядом с ним появляется модуль со
 * строками — его и тянет сервер, откуда бы он ни поднялся.
 *
 * Генерируется перед каждой сборкой и в гит не кладётся: два экземпляра одного текста
 * разъезжаются, и правят всегда не тот.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANGUAGES = ["ru"];
const FIRST = "README";

/** Заголовок раздела — первый `#` в файле: оглавление не приходится вести отдельно. */
const titleOf = (text, fallback) =>
  text
    .split("\n")
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim() ?? fallback;

const order = (a, b) => (a === FIRST ? -1 : b === FIRST ? 1 : a.localeCompare(b, "ru"));

async function collect(language) {
  const dir = path.join(root, language);
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .toSorted(order);

  const sections = [];
  for (const name of names) {
    const text = await readFile(path.join(dir, `${name}.md`), "utf8");
    sections.push({ name, title: titleOf(text, name), text });
  }
  return sections;
}

const languages = Object.fromEntries(
  await Promise.all(LANGUAGES.map(async (language) => [language, await collect(language)])),
);

const body = `// Собрано scripts/bundle-docs.mjs из markdown рядом. Не править руками.
import type { Language, Section } from "./index.ts";

export const CONTENT: Record<Language, Section[]> = ${JSON.stringify(languages, null, 2)};
`;

await writeFile(path.join(root, "src", "content.generated.ts"), body, "utf8");

const counts = Object.entries(languages).map(([lang, list]) => `${lang}: ${list.length}`);
console.log(`docs: собрано ${counts.join(", ")}`);
