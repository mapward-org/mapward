import { useMemo } from "react";
import { LiveFiles, LiveMap } from "@mapward/core";
import type { AppBridge, BridgeClient, FileSource, MapObject } from "@mapward/core";
import { useBridgeClient } from "../../../ports/bridge.tsx";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Файлы карты по мосту — источник живой модели на клиенте (решение 0041). Каждый файл и папка —
 * своя подписка: модель подписывается на то, что читает, и отписывается от того, что перестала.
 */
function bridgeFiles(bridge: BridgeClient<AppBridge>, ref: Ref): FileSource {
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

/**
 * Живая карта клиента — та же модель, что у сервера, из `core` (решение 0041). Одинаковые файлы
 * дают одинаковую карту, поэтому собранную карту по мосту не возят: возят файлы.
 */
export function useLiveMap(ref: Ref): LiveMap {
  const bridge = useBridgeClient();
  // oxlint-disable-next-line exhaustive-deps
  return useMemo(
    () => new LiveMap(new LiveFiles(bridgeFiles(bridge, ref)), ref),
    [bridge, ref.mapPath, ref.basePath, ref.name],
  );
}

/**
 * Карта целиком, пока её читает компонент-`observer`: он перерисуется, когда карта изменится, а
 * неизменённые ветки придут теми же объектами. Пока дочитывается — `undefined`.
 */
export function useMap(ref: Ref): MapObject | undefined {
  return useLiveMap(ref).snapshot;
}

export function useMapActions() {
  const bridge = useBridgeClient();
  return {
    open: (path: string) => void bridge.openPath({ path }),
    openExternal: (url: string) => void bridge.openExternal({ url }),
    /** Текст, которого нет на диске: мердженный конфиг метрики — решение 0019. */
    openVirtual: (title: string, text: string, language: string) =>
      void bridge.openVirtual({ title, text, language }),
    /**
     * Открыть объект отдельным табом редактора — решение 0026. Таб всегда показывает объект;
     * `group` говорит, какая вкладка в нём открыта, `metric` — что показана одна метрика.
     */
    openInTab: (params: {
      mapPath: string;
      basePath: string;
      name: string;
      address: string;
      group?: string;
      metric?: string;
    }) => void bridge.openInTab(params),
    /**
     * Перечитать карту — решение 0041. Карта у сервера одна и следит за собой сама; кнопка для
     * того, что вотчер пропустил. Промис — чтобы кнопка знала, когда перечитывание кончилось.
     */
    reloadMap: (ref: Ref): Promise<void> => bridge.reloadMap(ref),
    createDirective: (objectPath: string) => void bridge.createDirective({ objectPath }),
    /** Спрашивает и удаляет хост; список обновится сам — карта следится на файловой системе. */
    deleteDirective: (objectPath: string, directive: string) =>
      void bridge.deleteDirective({ objectPath, directive }),
  };
}
