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
