import { observer } from "mobx-react-lite";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { Turns } from "../adapters/turns.ts";
import { TurnsPanel } from "../model/turns-panel.ts";
import { TurnItem, TurnsBadge, TurnsDock, TurnsList } from "../ui/turns-button.tsx";

/**
 * Директивы, где ход у человека: кнопка с числом и список — решение 0034. Пустой список —
 * кнопки нет: иначе она висела бы поверх карты всегда.
 */
export const DirectiveTurns = observer(function DirectiveTurns() {
  const bridge = useBridgeClient();
  const turns = useLocalStore(() => new Turns(bridge));
  const panel = useLocalStore(() => new TurnsPanel());

  return turns.list.length === 0 ? null : (
    <TurnsDock hold={panel.popup.hold}>
      {panel.popup.open && (
        <TurnsList>
          {turns.list.map((turn) => (
            <TurnItem
              key={turn.path}
              turn={turn}
              now={panel.now}
              onTake={(one) => panel.take(one, turns)}
            />
          ))}
        </TurnsList>
      )}
      <TurnsBadge count={turns.list.length} onToggle={() => panel.popup.toggle()} />
    </TurnsDock>
  );
});
