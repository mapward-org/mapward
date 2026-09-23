import { useEffect, useState } from "react";
import type { Run } from "@mapward/core";
import { useViewState } from "../../../../services/state/index.ts";
import { useStopRun } from "../adapters/use-runs.ts";
import { inTab, type RunsTab } from "../pure-model/runs.ts";
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
  // Вкладка — удобство человека, как свёрнутые метрики: помнится у него, а в историю не идёт.
  const [tab, setTab] = useViewState<RunsTab>("runs-tab", "actions");
  const shown = inTab(props.runs, tab);
  // Названный прогон показывается, даже если он с другой вкладки: на него ведёт красная точка
  // метрики, и прятать его за вкладкой значило бы вести в пустоту.
  const named =
    props.selected === undefined ? undefined : props.runs.find((run) => run.id === props.selected);
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
      runs={shown}
      total={props.runs.length}
      tab={tab}
      onTab={setTab}
      selected={named ?? shown[0]}
      now={now}
      onSelect={props.onSelect}
      onStop={stop}
    />
  );
}
