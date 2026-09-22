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
import type { ChildrenMap } from "@mapward/core";
import { linkKind } from "@mapward/core";
import { tabHover } from "../../ui/tab-modifier.ts";

export type Positions = Record<string, { x: number; y: number }>;

/** Until a node has a saved position, it falls into a plain row — honest, if not pretty. */
function place(index: number) {
  return { x: (index % 3) * 170, y: Math.floor(index / 3) * 90 };
}

/**
 * Подпись узла. Иконки «в табе» нет — решение 0035: узел, который откроется табом, под ctrl
 * подчёркивается, а сам ctrl + клик ловит `onNodeClick` холста.
 */
function NodeLabel(props: { label: string; tab: boolean }) {
  return (
    <span className={`block truncate ${props.tab ? tabHover.tabOnly : ""}`}>{props.label}</span>
  );
}

function build(
  map: ChildrenMap,
  positions: Positions,
  onOpenTab?: (link: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes = map.nodes.map((node, index) => {
    const id = node.link ?? String(index);
    // Табом открывают объект: узел без адреса карты подсветки не получает.
    const tab = linkKind(id) === "object" ? onOpenTab : undefined;
    return {
      id,
      position: positions[id] ?? place(index),
      data: {
        label: <NodeLabel label={node.label ?? ""} tab={tab !== undefined} />,
      },
      style: {
        fontSize: 11,
        padding: 6,
        borderRadius: 4,
        border: "1px solid var(--mw-panel-border, #8884)",
        background: "var(--mw-editor-background)",
        color: "var(--mw-foreground)",
      },
    };
  });

  const edges = map.relations.map((relation, index) => ({
    id: relation.link ?? `edge-${index}`,
    source: relation.from ?? "",
    target: relation.to ?? "",
    label: relation.label,
    style: { stroke: "var(--mw-foreground)", opacity: 0.5 },
  }));

  return { nodes, edges };
}

export function Graph(props: {
  map: ChildrenMap;
  positions: Positions;
  viewport?: Viewport;
  onOpen: (link: string) => void;
  /** Открыть узел отдельным табом — ctrl + клик (решение 0026), без иконки на узле (0035). */
  onOpenTab?: (link: string) => void;
  onMove: (positions: Positions) => void;
  onViewport: (viewport: Viewport) => void;
}) {
  const [nodes, setNodes] = useState<Node[]>(
    () => build(props.map, props.positions, props.onOpenTab).nodes,
  );
  const { edges } = build(props.map, props.positions, props.onOpenTab);

  // Rebuild when the set of nodes changes or a saved position arrives — not on every render.
  const signature = props.map.nodes.map((node) => node.link).join("|");
  useEffect(() => {
    setNodes(build(props.map, props.positions, props.onOpenTab).nodes);
    // oxlint-disable-next-line exhaustive-deps
  }, [signature, props.positions, props.onOpenTab]);

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
        // Ctrl + клик открывает узел табом. Двойной клик остаётся переходом на месте: на
        // холсте одиночный клик выделяет и тащит, и открывать им было бы нечем (0026).
        onNodeClick={(event, node) => {
          if ((event.ctrlKey || event.metaKey) && linkKind(node.id) === "object") {
            props.onOpenTab?.(node.id);
          }
        }}
      >
        <Background gap={16} size={1} color="var(--mw-panel-border, #8883)" />
      </ReactFlow>
    </div>
  );
}
