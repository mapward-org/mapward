import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { ActionFormProps } from "@mapward/component";
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

/**
 * Своя форма экшона (`component`): собрать и выполнить `.tsx` умеют метрики, а фичи друг друга не
 * импортируют — вид формы приходит портом. Нет его — форма рисуется по полям.
 */
export type ActionFormView = ComponentType<{ action: string; props: ActionFormProps }>;

const ActionFormContext = createContext<ActionFormView | undefined>(undefined);

export function ProvideActionForm(props: { view: ActionFormView; children: ReactNode }) {
  return <ActionFormContext value={props.view}>{props.children}</ActionFormContext>;
}

export function useActionFormView(): ActionFormView | undefined {
  return useContext(ActionFormContext);
}
