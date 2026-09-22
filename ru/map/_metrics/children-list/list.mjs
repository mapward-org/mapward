/**
 * Дети объекта списком — строка на ребёнка со счётчиком директив.
 *
 * Карта детей уже отвечает на вопрос «кто с кем связан», и повторять её строками незачем.
 * Ценность списка в том, чего в графе нет: у кого лежит непрогнанная директива. Поэтому
 * в строке имя и состояние очереди, а не имя и всё.
 *
 * На вход приходит выдача `object-children-map` — `{ nodes, relations }`; связи не нужны,
 * берутся только узлы. На выходе `{ items }` для дисплея `list`.
 *
 * Состояние директивы считается так же, как его считает карта: файл в `_directives/` без
 * своего `.state.json` (или со `status` не `done`) — непрогнанный; со `status: "done"`, но
 * с текстом, разошедшимся с побайтной копией в состоянии, — изменившийся. Копию снимает
 * сервер, скрипт её только сравнивает.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const slash = (value = "") => value.replaceAll("\\", "/").replace(/\/+$/, "");

const mapPath = slash(process.env.MAPWARD_MAP_PATH);

/** Адрес ребёнка — это путь от корня карты: схему снимаем и получаем папку. */
const folderOf = (link = "") => link.replace(/^mapward:\/\//, "").replace(/^\/+/, "");

const listing = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

function directives(folder) {
  const base = join(mapPath, folder);
  const files = listing(join(base, "_directives"))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);

  let fresh = 0;
  let changed = 0;

  for (const name of files) {
    const text = read(join(base, "_directives", name));
    const raw = read(join(base, "_directives.state", `${name.replace(/\.md$/, "")}.state.json`));
    if (raw === null) {
      fresh += 1;
      continue;
    }
    let state = {};
    try {
      state = JSON.parse(raw);
    } catch {
      // Битое состояние — то же самое, что его нет: прогона по нему не подтвердить.
    }
    if (state.status !== "done") fresh += 1;
    else if (typeof state.directive === "string" && state.directive !== text) changed += 1;
  }

  return { total: files.length, fresh, changed };
}

const input = await new Promise((resolve) => {
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => resolve(raw));
});

const nodes = JSON.parse(input || "{}").nodes ?? [];

const items = nodes.map((node) => {
  const counts = directives(folderOf(node.link));
  const parts = [];
  if (counts.fresh > 0) parts.push(`${counts.fresh} непрогнанных`);
  if (counts.changed > 0) parts.push(`${counts.changed} изменившихся`);

  return {
    label: node.label,
    link: node.link,
    description:
      parts.length > 0
        ? `Директивы: ${parts.join(", ")} из ${counts.total}`
        : counts.total > 0
          ? `Директивы: все ${counts.total} прогнаны`
          : "Директив нет",
    status: parts.length > 0 ? "pending" : "idle",
  };
});

// Те, у кого есть что сделать, — наверх: ради них в список и смотрят.
items.sort(
  (a, b) =>
    Number(b.status === "pending") - Number(a.status === "pending") ||
    a.label.localeCompare(b.label, "ru"),
);

process.stdout.write(JSON.stringify({ items }));
