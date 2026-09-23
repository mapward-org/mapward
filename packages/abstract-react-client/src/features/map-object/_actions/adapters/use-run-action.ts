import { useCallback } from "react";
import type { RunSource, RunStarted } from "@mapward/core";
import { useBridgeClient } from "../../../../ports/bridge.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Запуск экшона через мост — решение 0038. Ответ приходит сразу, до конца прогона: номер или
 * ошибки полей. Сервер может и отказать целиком (экшона нет) — тогда это ошибка одной строкой,
 * а не упавший промис: форма её покажет.
 */
export function useRunAction(ref: Ref) {
  const bridge = useBridgeClient();
  return useCallback(
    async (
      action: string,
      inputs: Record<string, unknown>,
      source: RunSource,
    ): Promise<RunStarted & { failed?: string }> => {
      try {
        return await bridge.runAction({ ...ref, action, inputs, source });
      } catch (error) {
        return { failed: error instanceof Error ? error.message : String(error) };
      }
    },
    [bridge, ref.mapPath, ref.basePath, ref.name],
  );
}
