import { Background, type Edge, type Node, ReactFlow } from "@xyflow/react";
import type { ChildrenMap } from "../pure-model/children.ts";

/** Positions are a placeholder until map-state.json exists — a row is honest, at least. */
function layout(map: ChildrenMap): { nodes: Node[]; edges: Edge[] } {
  const nodes = map.nodes.map((node, index) => ({
    id: node.link ?? String(index),
    position: { x: (index % 3) * 160, y: Math.floor(index / 3) * 90 },
    data: { label: node.label ?? "" },
    style: {
      fontSize: 11,
      padding: 6,
      borderRadius: 4,
      border: "1px solid var(--vscode-panel-border, #8884)",
      background: "var(--vscode-editor-background)",
      color: "var(--vscode-foreground)",
    },
  }));

  const edges = map.relations.map((relation, index) => ({
    id: relation.link ?? `edge-${index}`,
    source: relation.from ?? "",
    target: relation.to ?? "",
    label: relation.label,
    style: { stroke: "var(--vscode-foreground)", opacity: 0.5 },
  }));

  return { nodes, edges };
}

export function Graph(props: { map: ChildrenMap; onOpen: (link: string) => void }) {
  const { nodes, edges } = layout(props.map);

  return (
    <div className="h-60 w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => props.onOpen(node.id)}
      >
        <Background gap={16} size={1} color="var(--vscode-panel-border, #8883)" />
      </ReactFlow>
    </div>
  );
}
