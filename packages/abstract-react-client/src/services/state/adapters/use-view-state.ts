import { useBridgeClient } from "../../../ports/bridge.tsx";
import { useStored } from "../../../lib/rxjs-react/index.ts";

/** Per-person view state: folded metrics, pan and zoom. Never leaves this machine. */
export function useViewState<T>(key: string, initial: T): [T, (value: T) => void, boolean] {
  const bridge = useBridgeClient();
  return useStored<T>(
    {
      get: (k) => bridge.getViewState({ key: k }),
      set: (k, value) => void bridge.setViewState({ key: k, value }),
    },
    key,
    initial,
  );
}
