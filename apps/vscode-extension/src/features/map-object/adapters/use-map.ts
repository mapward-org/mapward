import { useBridgeClient } from "@/kernel/bridge/context.tsx";
import { useObservable } from "@/shared/rxjs-react/index.ts";
import type { MapObject } from "../pure-model/model.ts";

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
  return { open: (path: string) => void bridge.openPath({ path }) };
}
