import type { Run } from "@mapward/core";
import { useBridgeClient } from "../../../../ports/bridge.tsx";
import { useObservable } from "../../../../lib/rxjs-react/index.ts";

/**
 * Прогоны объекта держит сервер (решение 0038): клиент только подписывается. Идущий прогон
 * меняется у сервера на каждом шаге, и подписка приносит его заново — экран обновляется живьём.
 */
export function useRuns(mapPath: string, address: string): Run[] {
  const bridge = useBridgeClient();
  return useObservable(
    () => bridge.watchRuns({ mapPath, address }),
    [bridge, mapPath, address],
    [],
  );
}

export function useStopRun(mapPath: string) {
  const bridge = useBridgeClient();
  return (id: string) => void bridge.stopRun({ mapPath, id });
}
