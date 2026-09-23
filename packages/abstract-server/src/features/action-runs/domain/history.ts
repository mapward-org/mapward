import type { Run } from "@mapward/core";

/** Сколько прогонов помнить на экшон или метрику — решение 0038: логи жирные, копить их незачем. */
export const KEEP = 20;

/** Папка прогонов в корне карты: `.`-папка в модель не попадает и `_`-правилом не задета. */
export const RUNS_DIR = ".mapward/runs";

/**
 * Файл прогонов объекта: адрес без схемы, слэши в `__`. У корня пути нет, и он получает `_root`:
 * пустое имя файла не завести.
 */
export function runsFile(address: string): string {
  const path = address.replace(/^mapward:\/\//, "").replace(/\/+$/, "");
  return `${path === "" ? "_root" : path.replaceAll("/", "__")}.json`;
}

/** Последние `KEEP` на каждую цель, свежие сверху. Идущий прогон не вытесняется никогда. */
export function trim(runs: Run[]): Run[] {
  const sorted = runs.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
  const seen = new Map<string, number>();
  return sorted.filter((run) => {
    const count = (seen.get(run.target) ?? 0) + 1;
    seen.set(run.target, count);
    return run.status === "running" || count <= KEEP;
  });
}

/**
 * Прогон, записанный идущим, после перезапуска окна уже не идёт: процесса нет, дописать его
 * некому. Показывать его идущим значило бы вечную крутилку.
 */
export const orphaned = (run: Run, at: string): Run =>
  run.status === "running"
    ? { ...run, status: "stopped", finishedAt: at, error: "прогон прервался вместе с окном" }
    : run;
