import type { ChildrenMap } from "../pure-model/children.ts";
import { Graph } from "../ui/graph.tsx";

export function ChildrenMapView(props: { map: ChildrenMap; onOpen: (link: string) => void }) {
  if (props.map.nodes.length === 0) return null;
  return <Graph map={props.map} onOpen={props.onOpen} />;
}
