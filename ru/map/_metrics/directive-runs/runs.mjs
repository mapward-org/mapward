/**
 * Сколько кругов съел воркфлоу — сводка прогонов по этапам, по всей карте.
 *
 * Состояние лежит по файлу на директиву в `_directives.state/` у каждого объекта, и
 * поодиночке оно ни о чём не говорит. Вместе оно отвечает на вопрос, ради которого
 * этапы и считаются: где директива ходит по кругу, а где прошла с первого раза.
 *
 * Счётчик `runs` появился не сразу, и у старых состояний его нет. Приписывать им единицу
 * было бы выдумкой: там написано «не знаю», и так оно и показывается.
 *
 * Путь до карты приходит в `MAPWARD_MAP_PATH` — аргументов скрипту не нужно.
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

/** Объекты карты: папки, кроме служебных на `_`. */
function folders(folder = "") {
  const out = [folder];
  for (const entry of listing(join(mapPath, folder))) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    out.push(...folders(folder ? `${folder}/${entry.name}` : entry.name));
  }
  return out;
}

const when = (value) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

const runs = [];

for (const folder of folders()) {
  const dir = join(mapPath, folder, "_directives.state");
  for (const entry of listing(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(".state.json")) continue;
    let state;
    try {
      state = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
    } catch {
      continue;
    }

    const name = entry.name.replace(/\.state\.json$/, "");
    const stages = Object.entries(state.runs ?? {});
    const last = state.run?.finishedAt ?? state.run?.startedAt ?? state.ran;

    runs.push({
      label: folder ? `${folder}: ${name}` : name,
      link: join(mapPath, folder, "_directives", `${name}.md`).replaceAll("\\", "/"),
      description: [
        stages.length > 0
          ? stages.map(([stage, count]) => `${stage} ${count}`).join(" · ")
          : "по этапам не считано",
        state.run?.stage
          ? `последний — ${state.run.stage}${state.run.finishedAt ? "" : ", не закрыт"}, ${when(last)}`
          : when(last)
            ? `прогон ${when(last)}`
            : null,
        state.status === "done" ? null : "не отмечена выполненной",
      ]
        .filter(Boolean)
        .join(" · "),
      status:
        state.run && !state.run.finishedAt
          ? "pending"
          : state.status === "done"
            ? "success"
            : "idle",
      at: last ? Date.parse(last) : 0,
      // Круги считаются по всем этапам разом: где их много, там директива ходила по кругу.
      circles: stages.reduce((sum, [, count]) => sum + count, 0),
    });
  }
}

// Свежее наверх: сводку читают, чтобы понять, чем воркфлоу занят сейчас.
runs.sort((a, b) => b.at - a.at);

const total = runs.reduce((sum, run) => sum + run.circles, 0);
const counted = runs.filter((run) => run.circles > 0).length;

const items = [
  {
    label: `Директив — ${runs.length}, прогонов — ${total}`,
    description: `счётчик по этапам есть у ${counted} из ${runs.length}; у остальных состояние писалось до него`,
    status: "success",
  },
  ...runs.map(({ at: _at, circles: _circles, ...item }) => item),
];

process.stdout.write(JSON.stringify({ items }));
