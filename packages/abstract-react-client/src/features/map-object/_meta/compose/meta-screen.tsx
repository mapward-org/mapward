import { useDeferredValue, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { objectIndex } from "@mapward/core";
import type { MapFile, MapObject } from "@mapward/core";
import { searchMeta } from "../pure-model/meta.ts";
import { MetaView, type MetaIcons } from "../ui/meta-view.tsx";

type Actions = {
  open: (path: string) => void;
  openVirtual: (title: string, text: string, language: string) => void;
};

/**
 * Мета-экран объекта: собирает вид с действиями моста. Что хост умеет, решается здесь —
 * клиент не рисует того, чего ему не обещали (решение 0014), а имена и происхождение
 * показываются всегда: это текст.
 *
 * Здесь же живёт запрос поиска. Поле откликается на каждую букву, а отбор по разделам идёт по
 * отложенному значению: на объекте с сотней директив набор не ждёт перерисовки списков. Запрос
 * никуда не сохраняется, а на другом объекте экран пересоздаётся, и поле начинается пустым.
 */
export function MetaScreen(props: {
  map: MapObject;
  object: MapObject;
  can: { openFile: boolean; virtualDocs: boolean };
  icons: MetaIcons;
  actions: Actions;
  directives: (files: MapFile[]) => ReactNode;
}) {
  const { object, actions } = props;
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const found = useMemo(() => searchMeta(object, deferred), [object, deferred]);

  return (
    <MetaView
      map={props.map}
      object={object}
      icons={props.icons}
      query={query}
      onQuery={setQuery}
      found={found}
      directives={props.directives}
      {...(props.can.openFile ? { onOpenFile: actions.open } : {})}
      {...(props.can.virtualDocs
        ? {
            // Мерджа нет файлом: его собирает карта из нескольких, и показывается он
            // документом, которого на диске не существует (решение 0019).
            onOpenObjectConfig: () =>
              actions.openVirtual(
                `${object.name}/_index.json`,
                JSON.stringify(objectIndex(object), null, 2),
                "json",
              ),
            onOpenMetricConfig: (metric) =>
              actions.openVirtual(
                `${object.name}/${metric.key}.json`,
                JSON.stringify(metric.config, null, 2),
                "json",
              ),
          }
        : {})}
    />
  );
}
