import { createContext, useContext, type ReactNode } from "react";
import type { ObjectRuns } from "./adapters/object-runs.ts";

const RunsContext = createContext<ObjectRuns | undefined>(undefined);

/** Прогоны открытого объекта — одна подписка на вид: её заводит точка входа (решение 0038). */
export function ProvideRuns(props: { runs: ObjectRuns; children: ReactNode }) {
  return <RunsContext value={props.runs}>{props.children}</RunsContext>;
}

export function useRuns(): ObjectRuns {
  const runs = useContext(RunsContext);
  if (!runs) throw new Error("ProvideRuns is missing above this component");
  return runs;
}
