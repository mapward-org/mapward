import { useEffect, useState } from "react";
import { useBridgeClient } from "../../../kernel/bridge/context.tsx";
import type { MapsState } from "../../../kernel/bridge/config.ts";

/** Subscribes rather than fetches: the config changes under us, by hand or by an agent. */
export function useMaps(): MapsState | undefined {
  const bridge = useBridgeClient();
  const [state, setState] = useState<MapsState>();

  useEffect(() => {
    const subscription = bridge.watchMaps(undefined).subscribe(setState);
    return () => subscription.unsubscribe();
  }, [bridge]);

  return state;
}

export function useMapsActions() {
  const bridge = useBridgeClient();
  return {
    createConfig: () => void bridge.createConfig(undefined),
    pickFolder: () => void bridge.pickFolder(undefined),
  };
}
