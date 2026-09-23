import { createContext, useContext, type ReactNode } from "react";
import type { ActionsStore } from "./model/actions-store.ts";

const ActionsContext = createContext<ActionsStore | undefined>(undefined);

/**
 * Экшоны экрана — один стор на вид: форма запуска у всех кнопок одна. Заводит его точка входа,
 * потому что числа идущих прогонов он берёт у прогонов объекта, а их тоже держит она.
 */
export function ProvideActions(props: { actions: ActionsStore; children: ReactNode }) {
  return <ActionsContext value={props.actions}>{props.children}</ActionsContext>;
}

export function useActions(): ActionsStore {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("ProvideActions is missing above this component");
  return actions;
}
