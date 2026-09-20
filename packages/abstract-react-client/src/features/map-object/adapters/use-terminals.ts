import { useCallback, useEffect, useState } from "react";
import { useBridgeClient } from "../../../ports/bridge.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

export function useTerminals(ref: Ref, address: string) {
  const bridge = useBridgeClient();
  const [terminals, setTerminals] = useState<{ name: string }[]>([]);

  const refresh = useCallback(() => {
    void bridge.listTerminals({ address }).then(setTerminals);
    // oxlint-disable-next-line exhaustive-deps
  }, [address]);

  useEffect(refresh, [refresh]);

  const after = <T>(promise: Promise<T>) => void promise.then(refresh);

  return {
    terminals,
    open: (fresh?: boolean) => after(bridge.openObjectTerminal({ ...ref, address, fresh })),
    // Показать именно тот, по которому кликнули: терминалов у объекта может быть несколько.
    show: (name: string) => void bridge.showTerminal({ name }),
    close: (name: string) => after(bridge.closeTerminal({ name })),
  };
}
