import { createContext, useContext, type ReactNode } from "react";
import type { ViewStates } from "./adapters/view-state.ts";

const ViewStatesContext = createContext<ViewStates | undefined>(undefined);

/** Состояние вида одно на клиент: его заводит точка входа и раздаёт всем. */
export function ProvideViewStates(props: { states: ViewStates; children: ReactNode }) {
  return <ViewStatesContext value={props.states}>{props.children}</ViewStatesContext>;
}

export function useViewStates(): ViewStates {
  const states = useContext(ViewStatesContext);
  if (!states) throw new Error("ProvideViewStates is missing above this component");
  return states;
}
