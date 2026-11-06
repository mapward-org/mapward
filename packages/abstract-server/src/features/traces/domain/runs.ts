import type { LogLine, Run, RunSource, RunStatus, RunStep } from "@mapward/core";

/** Сколько прогонов отдавать на экшон или метрику: экрану и ленте хватает последних. */
export const KEEP = 10;

/** Предел текста шага в прогоне: лог целиком лежит в файле, экрану хватит начала. */
const TEXT_LIMIT = 200_000;

const append = (text: string | undefined, line: string): string => {
  const next = `${text ?? ""}${line}\n`;
  return next.length <= TEXT_LIMIT ? next : next.slice(-TEXT_LIMIT);
};

const statusOf = (value: string | undefined): RunStatus =>
  value === "success" || value === "failure" || value === "stopped" ? value : "failure";

const isRunKind = (value: string | undefined): value is Run["kind"] =>
  value === "action" || value === "metric";

/** Имя шага, пока вызов своих шагов не назвал: плагин и метод. */
const callName = (line: LogLine): string => {
  const plugin = (line.plugin ?? "").replaceAll("\\", "/").replace(/\/+$/, "").split("/").pop();
  return [plugin, line.method].filter(Boolean).join(".");
};

/**
 * Прогоны из строк лога: трейс экшона или метрики — начало и конец, шаги, ход и вывод его
 * вызовов. Строки — по времени. Трейс без конца, которого нет среди живых, прервался вместе с
 * окном: дописать его некому, и показывать его идущим значило бы вечную крутилку.
 */
export function runsOf(lines: LogLine[], live: (trace: string) => boolean, now: string): Run[] {
  const runs = new Map<string, Run>();
  const current = new Map<string, RunStep>();
  /** Имя шага по умолчанию — первый вызов трейса. */
  const firstCall = new Map<string, string>();

  const stepOf = (run: Run): RunStep => {
    const existing = current.get(run.id);
    if (existing) return existing;
    const step: RunStep = {
      name: firstCall.get(run.id) ?? run.label,
      status: "running",
      startedAt: run.startedAt,
    };
    run.steps.push(step);
    current.set(run.id, step);
    return step;
  };

  for (const line of lines) {
    const id = line.trace;
    if (id === undefined) continue;
    if (line.kind === "trace-start") {
      if (!isRunKind(line.traceKind) || line.object === undefined) continue;
      runs.set(id, {
        id,
        kind: line.traceKind,
        target: line.target ?? "",
        object: line.object,
        label: line.label ?? line.target ?? id,
        source: (line.source ?? "ui") as RunSource,
        status: "running",
        startedAt: line.at,
        ...(line.inputs === undefined ? {} : { inputs: line.inputs }),
        ...(line.config === undefined ? {} : { config: line.config }),
        steps: [],
      });
      continue;
    }
    const run = runs.get(id);
    if (!run) continue;
    switch (line.kind) {
      case "call-start":
        if (line.parent === undefined && !firstCall.has(id)) firstCall.set(id, callName(line));
        break;
      case "step": {
        const previous = current.get(id);
        if (previous?.status === "running") {
          previous.status = "success";
          previous.finishedAt = line.at;
        }
        const step: RunStep = { name: line.text ?? "", status: "running", startedAt: line.at };
        run.steps.push(step);
        current.set(id, step);
        break;
      }
      case "log":
      case "error":
        stepOf(run).log = append(stepOf(run).log, line.text ?? "");
        break;
      case "out":
        stepOf(run).output = append(stepOf(run).output, line.text ?? "");
        break;
      case "call-end":
        // Упавший корневой вызов без своей строки ошибки: причина — в шаге.
        if (line.parent === undefined && line.status === "failure" && line.error) {
          const step = stepOf(run);
          if (!step.log) step.log = append(undefined, line.error);
        }
        break;
      case "trace-end": {
        run.status = statusOf(line.status);
        run.finishedAt = line.at;
        if (line.result !== undefined) run.result = line.result;
        if (line.error !== undefined) run.error = line.error;
        break;
      }
      default:
        break;
    }
  }

  for (const run of runs.values()) {
    if (run.status === "running" && !live(run.id)) {
      run.status = "stopped";
      run.finishedAt = now;
      run.error = "прогон прервался вместе с окном";
    }
    for (const step of run.steps) {
      if (step.status !== "running" || run.status === "running") continue;
      step.status = run.status === "success" ? "success" : run.status;
      step.finishedAt = run.finishedAt;
      if (run.status === "failure" && run.error && !step.log)
        step.log = append(undefined, run.error);
    }
  }
  return trim([...runs.values()]);
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
