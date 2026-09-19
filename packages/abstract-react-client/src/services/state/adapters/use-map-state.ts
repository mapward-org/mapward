import { useCallback, useEffect, useMemo, useState } from "react";
import { useBridgeClient } from "../../../ports/bridge.tsx";

export type Positions = Record<string, { x: number; y: number }>;
type MapState = { positions?: Positions };

/**
 * Node positions belong to the map, not to the person looking at it: everyone should open
 * the same picture. So they go to `map-state.json`, unlike pan and zoom.
 */
export function useMapState(mapPath: string) {
  const bridge = useBridgeClient();
  const [state, setState] = useState<MapState>({});

  useEffect(() => {
    let alive = true;
    void bridge.getMapState({ mapPath }).then((value) => {
      if (alive) setState((value ?? {}) as MapState);
    });
    return () => {
      alive = false;
    };
    // oxlint-disable-next-line exhaustive-deps
  }, [mapPath]);

  const move = useCallback(
    (positions: Positions) => {
      setState((previous) => {
        const next = { ...previous, positions: { ...previous.positions, ...positions } };
        void bridge.setMapState({ mapPath, value: next });
        return next;
      });
    },
    // oxlint-disable-next-line exhaustive-deps
    [mapPath],
  );

  // A fresh {} every render would restart every effect that watches positions.
  const positions = useMemo(() => state.positions ?? {}, [state.positions]);

  return { positions, move };
}
