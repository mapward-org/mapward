/**
 * Требования счётом, а не деревом: сколько в каком статусе и что на каком объекте висит.
 *
 * Дерево «Реестра требований» сделано для человека — по нему видно, где что лежит.
 * Спрашивают у требований другое: сколько осталось в работе и какие из них про этот
 * объект. Ответ на оба вопроса — фронтматтер, `status` и `object` (решения 0010 и 0011),
 * и здесь он сведён в числа.
 *
 * Требование без `object` считается продуктовым и принадлежит корню карты — так же, как
 * это считает `status.mjs` у реестра. `object` бывает списком: одно требование про
 * несколько объектов, и тогда оно считается каждому.
 *
 * Аргумент — корень проекта (`mapward://@`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2].replaceAll("\\", "/").replace(/\/+$/, "");
const base = join(root, "ru/requirements");

const ORDER = ["implementing", "ready-to-implement", "draft", "implemented", "без статуса"];

const MARK = {
  implementing: { status: "pending", color: "var(--vscode-charts-blue, #4c8eda)" },
  "ready-to-implement": { status: "pending" },
  draft: { status: "idle" },
  implemented: { status: "success" },
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

function frontmatter(text) {
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

const objectsOf = (meta) =>
  (meta.object ?? "mapward://")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const byStatus = new Map();
const byObject = new Map();
let total = 0;

for (const file of walk(base)) {
  const meta = frontmatter(readFileSync(file, "utf8"));
  const status = meta.status || "без статуса";
  total += 1;
  byStatus.set(status, (byStatus.get(status) ?? 0) + 1);

  for (const address of objectsOf(meta)) {
    const counts = byObject.get(address) ?? new Map();
    counts.set(status, (counts.get(status) ?? 0) + 1);
    byObject.set(address, counts);
  }
}

const rank = (status) => {
  const place = ORDER.indexOf(status);
  return place === -1 ? ORDER.length : place;
};

const spell = (counts) =>
  [...counts.entries()]
    .toSorted((a, b) => rank(a[0]) - rank(b[0]))
    .map(([status, count]) => `${status} ${count}`)
    .join(", ");

const items = [
  { label: `Всего требований — ${total}`, description: spell(byStatus), status: "success" },
  ...[...byStatus.entries()]
    .toSorted((a, b) => rank(a[0]) - rank(b[0]))
    .map(([status, count]) => ({
      label: `${status} — ${count}`,
      description: "статус из фронтматтера",
      ...(MARK[status] ?? { status: "idle" }),
    })),
  ...[...byObject.entries()]
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([address, counts]) => ({
      label: address,
      link: address,
      description: spell(counts),
      status: "idle",
    })),
];

process.stdout.write(JSON.stringify({ items }));
