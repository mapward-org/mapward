import { observer } from "mobx-react-lite";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useHost } from "../../../services/host/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { Turns, type RunFocus } from "../adapters/turns.ts";
import { TurnsPanel } from "../model/turns-panel.ts";
import { turnKey } from "../pure-model/turns.ts";
import { TurnItem, TurnsBadge, TurnsDock, TurnsList } from "../ui/turns-button.tsx";

/**
 * Лента в кружке сайдбара — решение 0034: что идёт и где ход у человека. Пустая — кнопки нет:
 * иначе она висела бы поверх карты всегда.
 *
 * `focus` ведёт пункт экшона на экран прогонов его объекта — той же просьбой «перейди к
 * объекту», что кнопка в файле директивы, поэтому объект в другой карте окна тоже находится.
 */
export const DirectiveTurns = observer(function DirectiveTurns(props: { focus?: RunFocus }) {
  const bridge = useBridgeClient();
  const host = useHost();
  const turns = useLocalStore(() => new Turns(bridge, props.focus, () => host.can.terminals));
  const panel = useLocalStore(() => new TurnsPanel());

  return turns.list.length === 0 ? null : (
    <TurnsDock hold={panel.popup.hold}>
      {panel.popup.open && (
        <TurnsList>
          {turns.list.map((turn) => (
            <TurnItem
              key={turnKey(turn)}
              turn={turn}
              now={panel.now}
              onTake={(one) => panel.take(one, turns)}
            />
          ))}
        </TurnsList>
      )}
      <TurnsBadge
        count={turns.button.count}
        busy={turns.button.busy}
        onToggle={() => panel.popup.toggle()}
      />
    </TurnsDock>
  );
});
