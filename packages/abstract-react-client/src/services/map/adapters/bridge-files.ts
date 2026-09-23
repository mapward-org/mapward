import type { AppBridge, BridgeClient, FileSource } from "@mapward/core";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Файлы карты по мосту — источник живой модели на клиенте (решение 0041). Каждый файл и папка —
 * своя подписка: модель подписывается на то, что читает, и отписывается от того, что перестала.
 */
export function bridgeFiles(bridge: BridgeClient<AppBridge>, ref: Ref): FileSource {
  const at = (path: string) => ({
    mapPath: ref.mapPath,
    basePath: ref.basePath,
    name: ref.name,
    path,
  });
  return {
    file: (path, next) => {
      const subscription = bridge
        .watchMapFile(at(path))
        .subscribe((text) => next(typeof text === "string" ? text : undefined));
      return () => subscription.unsubscribe();
    },
    list: (path, next) => {
      const subscription = bridge.watchMapFolder(at(path)).subscribe((entries) => next(entries));
      return () => subscription.unsubscribe();
    },
  };
}

/** Перечитать карту — кнопка рядом со стрелками навигации (решение 0041). */
export const reloadMap = (bridge: BridgeClient<AppBridge>, ref: Ref): Promise<void> =>
  bridge.reloadMap(ref);
