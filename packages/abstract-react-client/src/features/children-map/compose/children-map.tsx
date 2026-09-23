import { observer } from "mobx-react-lite";
import type { ChildrenMap } from "@mapward/core";
import { useViewStates } from "../../../services/state/ports.tsx";
import { useLocalStore } from "../../../lib/mobx/use-local-store.ts";
import { ChildrenMapStore } from "../model/children-map.ts";
import { useChildrenMapPort } from "../ports.tsx";
import { Graph } from "../ui/flow.tsx";

/**
 * Карта детей объекта — значение метрики `object-children-map`: узлы и связи собирает сервер, а
 * здесь они ложатся на холст. Сам холст — `@xyflow/react`, со своим состоянием в React; это
 * единственная связка, которой такое позволено (решение 0042).
 */
export const ChildrenMapView = observer(function ChildrenMapView(props: {
  map: ChildrenMap;
  address: string;
}) {
  const port = useChildrenMapPort();
  const views = useViewStates();
  const store = useLocalStore(
    () => new ChildrenMapStore(port.places, views, props.address),
    [props.address],
  );

  return props.map.nodes.length === 0 ? null : (
    <Graph
      map={props.map}
      positions={store.positions}
      viewport={store.view}
      onOpen={(link) => port.open(link)}
      onOpenTab={port.openTab}
      onMove={(positions) => store.move(positions)}
      onViewport={(viewport) => store.pan(viewport)}
    />
  );
});
