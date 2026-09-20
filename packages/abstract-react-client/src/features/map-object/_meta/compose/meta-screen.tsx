import type { ReactNode } from "react";
import { objectIndex } from "@mapward/core";
import type { MapObject } from "@mapward/core";
import { MetaView, type MetaIcons } from "../ui/meta-view.tsx";

type Actions = {
  open: (path: string) => void;
  openVirtual: (title: string, text: string, language: string) => void;
};

/**
 * Мета-экран объекта: собирает вид с действиями моста. Что хост умеет, решается здесь —
 * клиент не рисует того, чего ему не обещали (решение 0014), а имена и происхождение
 * показываются всегда: это текст.
 */
export function MetaScreen(props: {
  map: MapObject;
  object: MapObject;
  can: { openFile: boolean; virtualDocs: boolean };
  icons: MetaIcons;
  actions: Actions;
  onBack: () => void;
  directives: ReactNode;
}) {
  const { object, actions } = props;

  return (
    <MetaView
      map={props.map}
      object={object}
      icons={props.icons}
      onBack={props.onBack}
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
