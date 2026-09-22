/**
 * Кто от кого зависит внутри монорепы — и сходится ли это с тем, что нарисовано на карте.
 *
 * Связи между пакетами карта держит объектами в `relations/`, а правду о них знает
 * `package.json`. Разойтись они могут молча: зависимость добавили кодом, объект завести
 * забыли, и граф детей рисует вчерашний день. Поэтому метрика сверяет два списка и
 * показывает оба направления расхождения.
 *
 * Аргумент — корень проекта (`mapward://@`), путь до карты приходит в `MAPWARD_MAP_PATH`.
 * Пакет узнаётся по `props.codePath` объекта карты: имя из `package.json` в этой папке.
 * Так в список попадают и приложения, у которых `packageName` в `props` не лежит.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const slash = (value = "") => value.replaceAll("\\", "/").replace(/\/+$/, "");

const root = slash(process.argv[2]);
const mapPath = slash(process.env.MAPWARD_MAP_PATH);

const listing = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const json = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Обход объектов карты. Служебные ветки пропускаем: прототипы и общие метрики кода не
 * несут, а папки на `_` — это метрики, директивы и состояние, не объекты.
 */
const SKIP = new Set(["prototypes", "shared-metrics", "node_modules"]);

function objects(folder = "") {
  const out = [];
  for (const entry of listing(join(mapPath, folder))) {
    if (!entry.isDirectory() || entry.name.startsWith("_") || SKIP.has(entry.name)) continue;
    const next = folder ? `${folder}/${entry.name}` : entry.name;
    out.push(next, ...objects(next));
  }
  return out;
}

const packages = new Map(); // имя пакета → { address, label }
const addresses = new Map(); // адрес → имя пакета
const relations = []; // { from, to, address }

for (const folder of objects()) {
  const index = json(join(mapPath, folder, "_index.json"));
  if (!index) continue;
  const address = `mapward://${folder}`;
  const props = index.props ?? {};

  if (typeof props.from === "string" && typeof props.to === "string") {
    relations.push({ from: props.from, to: props.to, address });
    continue;
  }
  if (typeof props.codePath !== "string") continue;

  const manifest = json(join(root, props.codePath, "package.json"));
  if (!manifest?.name) continue;
  packages.set(manifest.name, { address, label: index.name ?? manifest.name, manifest });
  addresses.set(address, manifest.name);
}

const items = [];
const drawn = new Set(relations.map((relation) => `${relation.from} → ${relation.to}`));
const real = new Set();

for (const [name, { address, label, manifest }] of packages) {
  const deps = { ...manifest.dependencies, ...manifest.peerDependencies };
  for (const dep of Object.keys(deps)) {
    const target = packages.get(dep);
    if (!target) continue; // Внешние зависимости здесь не про архитектуру карты.
    const edge = `${address} → ${target.address}`;
    real.add(edge);
    items.push({
      label: `${label} → ${target.label}`,
      link: drawn.has(edge) ? relations.find((r) => `${r.from} → ${r.to}` === edge).address : undefined,
      description: drawn.has(edge)
        ? `${name} → ${dep}`
        : `${name} → ${dep} · связи нет на карте`,
      status: drawn.has(edge) ? "success" : "fail",
    });
  }
}

for (const relation of relations) {
  const edge = `${relation.from} → ${relation.to}`;
  if (real.has(edge)) continue;
  const from = addresses.get(relation.from) ?? relation.from;
  const to = addresses.get(relation.to) ?? relation.to;
  items.push({
    label: `${from} → ${to}`,
    link: relation.address,
    description: "связь нарисована на карте, но в package.json её нет",
    status: "fail",
  });
}

// Расхождения наверх: ради них список и читают.
items.sort(
  (a, b) =>
    Number(b.status === "fail") - Number(a.status === "fail") ||
    a.label.localeCompare(b.label, "ru"),
);

process.stdout.write(JSON.stringify({ items }));
