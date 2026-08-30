import {
  applyNodeChanges,
  Background,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlow,
  type Viewport,
} from "@xyflow/react";
import { useEffect, useState } from "react";
import type { ChildrenMap } from "../pure-model/children.ts";

export type Positions = Record<string, { x: number; y: number }>;

/** Until a node has a saved position, it falls into a plain row — honest, if not pretty. */
function place(index: number) {
  return { x: (index % 3) * 170, y: Math.floor(index / 3) * 90 };
}

function build(map: ChildrenMap, positions: Positions): { nodes: Node[]; edges: Edge[] } {
  const nodes = map.nodes.map((node, index) => {
    const id = node.link ?? String(index);
    return {
      id,
      position: positions[id] ?? place(index),
      data: { label: node.label ?? "" },
      style: {
        fontSize: 11,
        padding: 6,
        borderRadius: 4,
        border: "1px solid var(--vscode-panel-border, #8884)",
        background: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
      },
    };
  });

  const edges = map.relations.map((relation, index) => ({
    id: relation.link ?? `edge-${index}`,
    source: relation.from ?? "",
    target: relation.to ?? "",
    label: relation.label,
    style: { stroke: "var(--vscode-foreground)", opacity: 0.5 },
  }));

  return { nodes, edges };
}

export function Graph(props: {
  map: ChildrenMap;
  positions: Positions;
  viewport?: Viewport;
  onOpen: (link: string) => void;
  onMove: (positions: Positions) => void;
  onViewport: (viewport: Viewport) => void;
}) {
  const [nodes, setNodes] = useState<Node[]>(() => build(props.map, props.positions).nodes);
  const { edges } = build(props.map, props.positions);

  // Rebuild when the set of nodes changes or a saved position arrives — not on every render.
  const signature = props.map.nodes.map((node) => node.link).join("|");
  useEffect(() => {
    setNodes(build(props.map, props.positions).nodes);
    // oxlint-disable-next-line exhaustive-deps
  }, [signature, props.positions]);

  const change = (changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, nodes);
    setNodes(next);
    // Only a finished drag is worth writing to disk; every frame would be noise in git.
    if (changes.some((item) => item.type === "position" && item.dragging === false)) {
      props.onMove(Object.fromEntries(next.map((node) => [node.id, node.position])));
    }
  };

  return (
    <div className="h-full min-h-40 w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={change}
        defaultViewport={props.viewport}
        fitView={!props.viewport}
        proOptions={{ hideAttribution: true }}
        onMoveEnd={(_, viewport) => props.onViewport(viewport)}
        onNodeDoubleClick={(_, node) => props.onOpen(node.id)}
      >
        <Background gap={16} size={1} color="var(--vscode-panel-border, #8883)" />
      </ReactFlow>
    </div>
  );
}
