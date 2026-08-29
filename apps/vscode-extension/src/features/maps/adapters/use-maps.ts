import type { MapsState } from "@/kernel/bridge/config.ts";
import { useBridgeClient } from "@/kernel/bridge/context.tsx";
import { useObservable } from "@/shared/rxjs-react/index.ts";

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
