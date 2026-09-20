import { useCallback, useEffect, useState } from "react";
import { useBridgeClient } from "../../../ports/bridge.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

export function useTerminals(ref: Ref, address: string) {
  const bridge = useBridgeClient();
  const [terminals, setTerminals] = useState<{ id: string; name: string }[]>([]);

  const refresh = useCallback(() => {
    void bridge.listTerminals({ address }).then(setTerminals);
    // oxlint-disable-next-line exhaustive-deps
  }, [address]);

  useEffect(refresh, [refresh]);

  const after = <T>(promise: Promise<T>) => void promise.then(refresh);

  return {
    terminals,
    open: (fresh?: boolean) => after(bridge.openObjectTerminal({ ...ref, address, fresh })),
    /**
     * Кнопка этапа: фраза уходит в живую сессию объекта, промпт агент берёт из MCP сам —
     * решение 0017. Сессию выбирает хост, клиент про неё ничего не знает.
     */
    runStage: (directive: string, stage: string) =>
      after(bridge.runStage({ ...ref, address, directive, stage })),
    // Показать именно тот, по которому кликнули: терминалов у объекта может быть несколько.
    show: (id: string) => void bridge.showTerminal({ id }),
    close: (id: string) => after(bridge.closeTerminal({ id })),
  };
}
