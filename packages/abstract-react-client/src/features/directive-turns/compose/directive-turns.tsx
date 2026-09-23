import { useTurnActions, useTurns } from "../adapters/use-turns.ts";
import { TurnsButton } from "../ui/turns-button.tsx";

/** Директивы, где ход у человека: кнопка с числом и список — решение 0034. */
export function DirectiveTurns() {
  const turns = useTurns();
  const actions = useTurnActions();
  return <TurnsButton turns={turns} onTake={actions.take} />;
}
