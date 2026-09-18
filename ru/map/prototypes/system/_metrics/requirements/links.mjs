/**
 * Проверяет, что `object` у требований ведёт на существующий объект карты — решение 0011.
 *
 * Агент для этого не нужен: карта лежит на диске, скрипт её обходит и сверяет адреса.
 * На вход приходит выдача read-dir с текстом файлов, на выходе { items } — только сироты.
 *
 * cwd — корень карты, так решение 0004 запускает скрипты.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function addresses(dir = ".", prefix = "") {
  const found = new Set();

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // Служебное с подчёркивания — не объект и не путь к объекту.
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;

    const address = prefix ? `${prefix}/${entry.name}` : entry.name;
    const inside = join(dir, entry.name);

    // Папка без `_index.json` — группа: сама не объект, но внутри объекты бывают.
    // Обход последовательный: карта маленькая, а читается она понятнее.
    // oxlint-disable-next-line no-await-in-loop
    const entries = await readdir(inside, { withFileTypes: true });
    if (entries.some((child) => child.name === "_index.json")) found.add(`mapward://${address}`);

    // oxlint-disable-next-line no-await-in-loop
    for (const nested of await addresses(inside, address)) found.add(nested);
  }

  return found;
}

function frontmatter(text = "") {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => /^([\w-]+)\s*:\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map((parsed) => [parsed[1], parsed[2].trim().replace(/^["']|["']$/g, "")]),
  );
}

const title = (text = "", name = "") =>
  /^#\s+(.+)$/m.exec(text.replace(/^---[\s\S]*?---/, ""))?.[1]?.trim() ?? name.replace(/\.md$/, "");

function* files(nodes = []) {
  for (const node of nodes) {
    if (node.isDir) yield* files(node.children);
    else yield node;
  }
}

const input = await new Promise((resolve) => {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => resolve(raw));
});

const known = await addresses();
known.add("mapward://");

const items = [];

for (const file of files(JSON.parse(input || "{}").children)) {
  const meta = frontmatter(file.text);
  if (!meta.object) continue;

  const broken = meta.object
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((value) => value.trim())
    .filter((address) => address && !known.has(address));

  if (broken.length === 0) continue;

  items.push({
    label: title(file.text, file.name),
    description: `адрес не разрешается: ${broken.join(", ")}`,
    link: file.link,
    status: "fail",
  });
}

process.stdout.write(JSON.stringify({ items }));
