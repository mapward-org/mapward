import type { Turn } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useObservable } from "../../../lib/rxjs-react/index.ts";

/** Список держит сервер, в памяти (решение 0034): клиент только подписывается. */
export function useTurns(): Turn[] {
  const bridge = useBridgeClient();
  return useObservable(() => bridge.watchTurns(undefined), [bridge], []);
}

export function useTurnActions() {
  const bridge = useBridgeClient();
  return {
    /** Открыл пункт — взял ход: директива открывается, пункт уходит. */
    take: (turn: Turn) => {
      void bridge.openPath({ path: turn.path });
      void bridge.dismissTurn({
        mapPath: turn.mapPath,
        address: turn.address,
        directive: turn.directive,
      });
    },
  };
}
