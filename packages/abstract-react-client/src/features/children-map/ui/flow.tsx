import {
  applyNodeChanges,
  Background,
  type Edge,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  type Viewport,
} from "@xyflow/react";
import { useEffect, useState, type ReactNode } from "react";
import type { ChildrenMap, ObjectRef } from "@mapward/core";
import { linkKind } from "@mapward/core";
import { canvasClasses } from "../../../lib/ui/canvas-classes.ts";
import { tabHover } from "../../../lib/ui/tab-hover.ts";

export type Positions = Record<string, { x: number; y: number }>;

/** Until a node has a saved position, it falls into a plain row — honest, if not pretty. */
function place(index: number) {
  return { x: (index % 3) * 170, y: Math.floor(index / 3) * 90 };
}

/**
 * Связка карты детей с `@xyflow/react` — единственный файл клиента, где живёт состояние React
 * (решение 0042): у холста своё состояние узлов, и библиотека ведёт его сама. Всё, что знает
 * карта, приходит сюда пропсами и уходит обратно колбэками.
 */

/**
 * Подпись узла. Иконки «в табе» нет — решение 0035: узел, который откроется табом, под ctrl
 * подчёркивается, а сам ctrl + клик ловит `onNodeClick` холста.
 */
function NodeLabel(props: { label: string; tab: boolean }) {
  return (
    <span className={`block truncate ${props.tab ? tabHover.tabOnly : ""}`}>{props.label}</span>
  );
}

/** Ширина карточки на холсте, пока карта не задала свою: узлы не должны наезжать на соседей. */
const CARD_WIDTH = 280;

const css = (size: ObjectRef["width"]) => (typeof size === "number" ? `${size}px` : size);

/**
 * Узел-карточка. Точки связей невидимы, но нужны: без них холст не знает, куда вести связь.
 * Карточку внутри рисует её фича — сюда она приходит готовой.
 */
function CardNode(props: NodeProps<Node<{ content: ReactNode }>>) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {props.data.content}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

const NODE_TYPES = { card: CardNode };

/** Узел с `object` — карточка объекта, без него — квадрат с подписью, как раньше. */
function cardNode(
  item: ObjectRef,
  id: string,
  index: number,
  positions: Positions,
  content: ReactNode,
): Node {
  return {
    id,
    type: "card",
    position: positions[id] ?? place(index),
    dragHandle: `.${canvasClasses.dragHandle}`,
    data: { content },
    style: { width: css(item.width) ?? `${CARD_WIDTH}px` },
  };
}

function build(
  map: ChildrenMap,
  positions: Positions,
  onOpenTab?: (link: string) => void,
  renderCard?: (item: ObjectRef) => ReactNode,
): { nodes: Node[]; edges: Edge[] } {
  const nodes = map.nodes.map((node, index) => {
    const id = node.link ?? String(index);
    if (typeof node.object === "string" && renderCard) {
      const item = node as ObjectRef;
      return cardNode(item, id, index, positions, renderCard(item));
    }
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
  viewport?: Viewport | undefined;
  onOpen: (link: string) => void;
  /** Открыть узел отдельным табом — ctrl + клик (решение 0026), без иконки на узле (0035). */
  onOpenTab?: ((link: string) => void) | undefined;
  onMove: (positions: Positions) => void;
  onViewport: (viewport: Viewport) => void;
  /** Карточка объекта в узле с `object`; её рисует фича карточки. */
  renderCard?: ((item: ObjectRef) => ReactNode) | undefined;
}) {
  const [nodes, setNodes] = useState<Node[]>(
    () => build(props.map, props.positions, props.onOpenTab, props.renderCard).nodes,
  );
  const { edges } = build(props.map, props.positions, props.onOpenTab);

  // Rebuild when the set of nodes changes or a saved position arrives — not on every render.
  // Карточке важны ещё вкладка и размер: они приходят с узлом, а не с позицией.
  const signature = props.map.nodes
    .map((node) => `${node.link}:${node.group ?? ""}:${node.width ?? ""}:${node.maxHeight ?? ""}`)
    .join("|");
  useEffect(() => {
    setNodes(build(props.map, props.positions, props.onOpenTab, props.renderCard).nodes);
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
        nodeTypes={NODE_TYPES}
        // Узел за краем холста не рисуется — и его карточка не подписана на метрики: цена
        // карты — то, что видно, а не всё, что на ней лежит.
        onlyRenderVisibleElements
        onNodesChange={change}
        defaultViewport={props.viewport}
        fitView={!props.viewport}
        proOptions={{ hideAttribution: true }}
        onMoveEnd={(_, viewport) => props.onViewport(viewport)}
        // Двойной клик по карточке — это клик по её метрикам, а не переход: у карточки для
        // перехода есть своё имя в шапке.
        onNodeDoubleClick={(_, node) => node.type !== "card" && props.onOpen(node.id)}
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
