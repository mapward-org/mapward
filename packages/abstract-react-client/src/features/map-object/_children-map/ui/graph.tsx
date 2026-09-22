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
import { TabIcon } from "../../ui/icons.tsx";

export type Positions = Record<string, { x: number; y: number }>;

/** Until a node has a saved position, it falls into a plain row — honest, if not pretty. */
function place(index: number) {
  return { x: (index % 3) * 170, y: Math.floor(index / 3) * 90 };
}

/**
 * Подпись узла с иконкой «в табе» — решение 0026: про ctrl + клик, которого не видно, никто
 * не узнаёт. `nodrag` нужен затем, что узел таскают мышью, а по иконке в него кликают.
 */
function NodeLabel(props: { label: string; link: string; onOpenTab?: (link: string) => void }) {
  return (
    <span className="group/node flex items-center gap-1">
      <span className="truncate">{props.label}</span>
      {props.onOpenTab && (
        <button
          type="button"
          title="Открыть отдельным табом"
          className="nodrag hidden shrink-0 opacity-60 group-hover/node:block hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenTab?.(props.link);
          }}
        >
          {TabIcon}
        </button>
      )}
    </span>
  );
}

function build(
  map: ChildrenMap,
  positions: Positions,
  onOpenTab?: (link: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes = map.nodes.map((node, index) => {
    const id = node.link ?? String(index);
    // Табом открывают объект: узел без адреса карты иконки не получает.
    const tab = linkKind(id) === "object" ? onOpenTab : undefined;
    return {
      id,
      position: positions[id] ?? place(index),
      data: {
        label: (
          <NodeLabel
            label={node.label ?? ""}
            link={id}
            {...(tab === undefined ? {} : { onOpenTab: tab })}
          />
        ),
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
  /** Открыть узел отдельным табом — ctrl + клик и иконка на узле (решение 0026). */
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
          if (event.ctrlKey || event.metaKey) props.onOpenTab?.(node.id);
        }}
      >
        <Background gap={16} size={1} color="var(--mw-panel-border, #8883)" />
      </ReactFlow>
    </div>
  );
}
