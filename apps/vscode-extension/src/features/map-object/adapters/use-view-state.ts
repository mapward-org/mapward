import { useBridgeClient } from "@/kernel/bridge/context.tsx";
import { useStored } from "@/shared/rxjs-react/index.ts";

/** Per-person view state: folded metrics, pan and zoom. Never leaves this machine. */
export function useViewState<T>(key: string, initial: T): [T, (value: T) => void] {
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
