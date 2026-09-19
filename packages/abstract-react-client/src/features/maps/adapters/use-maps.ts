import type { MapsState } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useObservable } from "../../../lib/rxjs-react/index.ts";

/** Subscribes rather than fetches: the config changes under us, by hand or by an agent. */
export function useMaps(): MapsState | undefined {
  const bridge = useBridgeClient();
  return useObservable(() => bridge.watchMaps(undefined), [bridge]);
}

export function useMapsActions() {
  const bridge = useBridgeClient();
  return {
    createConfig: () => void bridge.createConfig(undefined),
    pickFolder: () => void bridge.pickFolder(undefined),
    openPath: (path: string) => void bridge.openPath({ path }),
  };
}
