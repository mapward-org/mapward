/**
 * Тестовый дисплей-компонент (решение 0037): директивы карты по статусам и где они сейчас.
 *
 * Статус и последний этап — из состояния прогона в `_directives.state/`: `status: done` ставит
 * этап, который закрывает директиву.
 * Путь до карты приходит в `MAPWARD_MAP_PATH`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const mapPath = process.env.MAPWARD_MAP_PATH.replaceAll("\\", "/").replace(/\/+$/, "");

const listing = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

function folders(folder = "") {
  const out = [folder];
  for (const entry of listing(join(mapPath, folder))) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    out.push(...folders(folder ? `${folder}/${entry.name}` : entry.name));
  }
  return out;
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

const directives = [];
for (const folder of folders()) {
  const dir = join(mapPath, folder, "_directives");
  for (const entry of listing(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const state = readJson(
      join(mapPath, folder, "_directives.state", entry.name.replace(/\.md$/, ".state.json")),
    );
    directives.push({
      name: entry.name.replace(/\.md$/, ""),
      object: `mapward://${folder}`,
      file: `${mapPath}/${folder ? `${folder}/` : ""}_directives/${entry.name}`,
      status: state?.status === "done" ? "done" : "open",
      stage: state?.run?.stage ?? null,
      runs: Object.values(state?.runs ?? {}).reduce((sum, count) => sum + count, 0),
    });
  }
}

directives.sort((a, b) => b.name.localeCompare(a.name));
console.log(JSON.stringify({ directives }));
