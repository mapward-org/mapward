import { useEffect, useState } from "react";
import type { Run } from "@mapward/core";
import { useStopRun } from "../adapters/use-runs.ts";
import { pickRun } from "../pure-model/runs.ts";
import { RunsView } from "../ui/runs-view.tsx";

/**
 * Экран прогонов: прогоны приходят сверху — на них подписан весь вид объекта, им же питаются
 * счётчики у кнопок и красная точка метрики, — а выбор живёт в истории (решение 0036): «назад»
 * возвращает к тому прогону, который читали.
 */
export function RunsScreen(props: {
  mapPath: string;
  runs: Run[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const stop = useStopRun(props.mapPath);
  const running = props.runs.some((run) => run.status === "running");
  const [now, setNow] = useState(() => Date.now());

  // Время идущего прогона тикает само: подписка приносит только смену шагов, а не секунды.
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, props.runs]);

  return (
    <RunsView
      runs={props.runs}
      selected={pickRun(props.runs, props.selected)}
      now={now}
      onSelect={props.onSelect}
      onStop={stop}
    />
  );
}
