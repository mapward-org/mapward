import type { Viewport } from "@xyflow/react";
import { useMapState } from "../../../../services/state/index.ts";
import { useViewState } from "../../../../services/state/index.ts";
import type { ChildrenMap } from "@mapward/core";
import { Graph } from "../ui/graph.tsx";

export function ChildrenMapView(props: {
  map: ChildrenMap;
  mapPath: string;
  address: string;
  onOpen: (link: string) => void;
  /** Открыть узел отдельным табом — решение 0026; хост не умеет табы — параметра нет. */
  onOpenTab?: (link: string) => void;
}) {
  const { positions, move } = useMapState(props.mapPath);
  // Where the canvas is panned is nobody's business but the viewer's.
  const [viewport, setViewport] = useViewState<Viewport | undefined>(
    `viewport:${props.address}`,
    undefined,
  );

  if (props.map.nodes.length === 0) return null;

  return (
    <Graph
      map={props.map}
      positions={positions}
      viewport={viewport}
      onOpen={props.onOpen}
      {...(props.onOpenTab === undefined ? {} : { onOpenTab: props.onOpenTab })}
      onMove={move}
      onViewport={setViewport}
    />
  );
}
