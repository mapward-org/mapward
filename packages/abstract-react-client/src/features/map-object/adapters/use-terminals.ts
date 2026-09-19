import { useCallback, useEffect, useState } from "react";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import type { DirectiveMode } from "@mapward/core";

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
    close: (name: string) => after(bridge.closeTerminal({ name })),
    run: (directive: string, mode: DirectiveMode, fresh?: boolean) =>
      after(bridge.runDirective({ ...ref, address, directive, mode, fresh })),
  };
}
