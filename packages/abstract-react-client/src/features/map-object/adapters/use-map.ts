import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useObservable } from "../../../lib/rxjs-react/index.ts";
import type { MapObject } from "@mapward/core";

type Ref = { mapPath: string; basePath: string; name: string };

/** Subscribes rather than fetches: the map is edited by hand and by agents. */
export function useMap(ref: Ref): MapObject | undefined {
  const bridge = useBridgeClient();
  return useObservable(() => bridge.watchMap(ref), [ref.mapPath, ref.basePath, ref.name]) as
    | MapObject
    | undefined;
}

export function useMapActions() {
  const bridge = useBridgeClient();
  return {
    open: (path: string) => void bridge.openPath({ path }),
    openExternal: (url: string) => void bridge.openExternal({ url }),
    createDirective: (objectPath: string) => void bridge.createDirective({ objectPath }),
  };
}
