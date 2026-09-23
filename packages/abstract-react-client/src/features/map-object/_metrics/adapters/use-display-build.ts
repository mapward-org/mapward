import type { DisplayBuild } from "@mapward/core";
import { useBridgeClient } from "../../../../ports/bridge.tsx";
import { useObservable } from "../../../../lib/rxjs-react/index.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Собранный компонент метрики — решение 0037. Собирает сервер, подписка приносит новую сборку,
 * когда меняется компонент или то, что он импортирует. `undefined` — сборка ещё идёт.
 */
export function useDisplayBuild(ref: Ref, metric: string): DisplayBuild | undefined {
  const bridge = useBridgeClient();
  return useObservable(
    () => bridge.watchDisplay({ ...ref, metric }),
    [ref.mapPath, ref.basePath, ref.name, metric],
  ) as DisplayBuild | undefined;
}
