import type { Viewport } from "@xyflow/react";
import { useMapState } from "../../adapters/use-map-state.ts";
import { useViewState } from "../../adapters/use-view-state.ts";
import type { ChildrenMap } from "../pure-model/children.ts";
import { Graph } from "../ui/graph.tsx";

export function ChildrenMapView(props: {
  map: ChildrenMap;
  mapPath: string;
  address: string;
  onOpen: (link: string) => void;
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
      onMove={move}
      onViewport={setViewport}
    />
  );
}
