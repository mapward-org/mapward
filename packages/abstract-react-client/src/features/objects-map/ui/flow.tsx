import {
  applyNodeChanges,
  Background,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { MapOp, ObjectRef, ObjectsMap, Point, ViewNode, ViewShape } from "@mapward/core";
import { canvasClasses } from "../../../lib/ui/canvas-classes.ts";
import { tabHover } from "../../../lib/ui/tab-hover.ts";
import type { Deletable, Popover, Tool } from "../pure-model/tools.ts";
import { dropOp, dropTarget, type Rect } from "../pure-model/drop.ts";
import { layout, type Box } from "../pure-model/layout.ts";

/**
 * Связка вьюхи карты с `@xyflow/react` — единственный файл клиента, где живёт состояние React
 * (решение 0042): у холста своё состояние узлов, и библиотека ведёт его сама. Всё, что знает
 * карта, приходит сюда пропсами и уходит обратно колбэками — операциями правки (решение 0044).
 */

type Handlers = {
  /** Подпись поправлена на месте; пустая или та же — правки нет. */
  commit: (id: string, text: string) => void;
  cancel: () => void;
  expand: (id: string, expanded: boolean) => void;
  preview: (id: string) => void;
};

type ObjectData = {
  node: ViewNode;
  renaming: boolean;
  connecting: boolean;
  highlight: boolean;
  handlers: Handlers;
  content?: ReactNode;
};

type NoteData = { shape: ViewShape; renaming: boolean; handlers: Handlers };

const frame = "var(--mw-panel-border, #8884)";

/** Точки связей видны, только когда выбрана стрелка: иначе они мешают тащить узел. */
function Ends(props: { connecting: boolean }) {
  const style = props.connecting
    ? { width: 8, height: 8, background: "var(--mw-focus-border, #3794ff)" }
    : { opacity: 0 };
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={style}
        isConnectable={props.connecting}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={style}
        isConnectable={props.connecting}
      />
    </>
  );
}

/** Подпись, которую правят на месте: поле без состояния React, значение берётся на Enter. */
function Label(props: { text: string; renaming: boolean; id: string; handlers: Handlers }) {
  if (!props.renaming) return <span className="block truncate">{props.text}</span>;
  const done = (value: string) => props.handlers.commit(props.id, value);
  return (
    <input
      className="nodrag w-full bg-transparent text-inherit outline-none"
      autoFocus
      defaultValue={props.text}
      onBlur={(event) => done(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") done(event.currentTarget.value);
        if (event.key === "Escape") props.handlers.cancel();
      }}
    />
  );
}

function ExpandButton(props: { node: ViewNode; handlers: Handlers }) {
  if (!props.node.expandable) return null;
  return (
    <button
      type="button"
      title={props.node.expanded ? "Свернуть" : "Развернуть жильцов"}
      className="nodrag rounded px-1 text-[10px] opacity-70 hover:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        props.handlers.expand(props.node.id, !props.node.expanded);
      }}
    >
      {props.node.expanded ? "−" : "+"}
    </button>
  );
}

const SHAPES: Record<ViewNode["shape"], CSSProperties> = {
  rect: { borderRadius: 2 },
  round: { borderRadius: 12 },
  ellipse: { borderRadius: "50%" },
  diamond: { clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)", padding: "6px 24px" },
  note: { borderRadius: 2, boxShadow: "2px 2px 0 rgba(0,0,0,.25)" },
};

/** Простая карточка — фигура нужной формы и цвета с подписью. Ссылка обведена пунктиром. */
function SimpleNode(props: NodeProps<Node<ObjectData>>) {
  const { node, handlers } = props.data;
  return (
    <div
      className="flex h-full w-full items-center gap-1 px-2 text-[11px]"
      style={{
        ...SHAPES[node.shape],
        background: node.color ?? "var(--mw-editor-background)",
        color: "var(--mw-foreground)",
        border: `1px ${node.kind === "ref" ? "dashed" : "solid"} ${
          props.selected ? "var(--mw-focus-border, #3794ff)" : frame
        }`,
      }}
    >
      <Ends connecting={props.data.connecting} />
      {node.kind === "ref" && <span title="Ссылка на чужой объект">↗</span>}
      <div className={`min-w-0 flex-1 text-center ${tabHover.tabOnly}`}>
        <Label text={node.label} renaming={props.data.renaming} id={node.id} handlers={handlers} />
      </div>
      <ExpandButton node={node} handlers={handlers} />
    </div>
  );
}

/** Полное превью — карточка объекта; её рисует своя фича, сюда она приходит готовой. */
function CardNode(props: NodeProps<Node<ObjectData>>) {
  const { node, handlers } = props.data;
  return (
    <div className="relative" style={node.kind === "ref" ? { outline: `1px dashed ${frame}` } : {}}>
      <Ends connecting={props.data.connecting} />
      {props.data.content}
      {node.expandable && (
        <div className="absolute right-1 bottom-1">
          <ExpandButton node={node} handlers={handlers} />
        </div>
      )}
    </div>
  );
}

/**
 * Развёрнутая группа — прозрачная рамка: жильцы видны сквозь неё. В правом верхнем углу —
 * превью самой группы и «свернуть».
 */
function GroupNode(props: NodeProps<Node<ObjectData>>) {
  const { node, handlers } = props.data;
  return (
    <div
      className="h-full w-full rounded-md text-[11px]"
      style={{
        border: `1px ${node.kind === "ref" ? "dashed" : "solid"} ${
          props.data.highlight || props.selected ? "var(--mw-focus-border, #3794ff)" : frame
        }`,
        background: props.data.highlight ? "rgba(55,148,255,.08)" : "transparent",
        color: "var(--mw-foreground)",
      }}
    >
      <Ends connecting={props.data.connecting} />
      <div className={`flex items-center gap-1 px-2 py-1 ${canvasClasses.dragHandle}`}>
        <div className="min-w-0 flex-1 font-semibold">
          <Label
            text={node.label}
            renaming={props.data.renaming}
            id={node.id}
            handlers={handlers}
          />
        </div>
        <button
          type="button"
          title="Превью группы"
          className="nodrag rounded px-1 opacity-70 hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            handlers.preview(node.id);
          }}
        >
          ⋯
        </button>
        <ExpandButton node={node} handlers={handlers} />
      </div>
    </div>
  );
}

/** Фигура — пометка на холсте, не объект: прямоугольник, круг или текст. */
function NoteNode(props: NodeProps<Node<NoteData>>) {
  const { shape, handlers } = props.data;
  const border =
    shape.kind === "text"
      ? "none"
      : `1px solid ${props.selected ? "var(--mw-focus-border, #3794ff)" : frame}`;
  return (
    <div
      className="flex h-full w-full items-center justify-center p-1 text-[11px]"
      style={{
        border,
        borderRadius: shape.kind === "ellipse" ? "50%" : 2,
        background: shape.kind === "text" ? "transparent" : (shape.color ?? "transparent"),
        color: "var(--mw-foreground)",
        outline: shape.kind === "text" && props.selected ? `1px dashed ${frame}` : "none",
      }}
    >
      <Label
        text={shape.text ?? ""}
        renaming={props.data.renaming}
        id={shape.id}
        handlers={handlers}
      />
    </div>
  );
}

const NODE_TYPES = { simple: SimpleNode, card: CardNode, group: GroupNode, note: NoteNode };

const css = (size: ObjectRef["width"]) => (typeof size === "number" ? `${size}px` : size);

type Build = {
  map: ObjectsMap;
  renaming: string | undefined;
  connecting: boolean;
  highlight: string | undefined;
  handlers: Handlers;
  renderCard: (item: ObjectRef) => ReactNode;
};

function build(params: Build): { nodes: Node[]; boxes: Box[] } {
  const boxes = layout(params.map);
  const byId = new Map(params.map.nodes.map((node) => [node.id, node]));
  const nodes: Node[] = boxes.map((box) => {
    const node = byId.get(box.id) as ViewNode;
    const data: ObjectData = {
      node,
      renaming: params.renaming === node.id,
      connecting: params.connecting,
      highlight: params.highlight === node.id,
      handlers: params.handlers,
    };
    const common = {
      id: node.id,
      position: box.position,
      ...(box.parent === undefined ? {} : { parentId: box.parent }),
    };
    if (node.expanded) {
      return {
        ...common,
        type: "group",
        data,
        dragHandle: `.${canvasClasses.dragHandle}`,
        style: { width: box.width, height: box.height },
      };
    }
    if (node.view === "preview") {
      const item: ObjectRef = {
        object: node.object,
        ...(node.group === undefined ? {} : { group: node.group }),
        ...(node.width === undefined ? {} : { width: node.width }),
        ...(node.maxHeight === undefined ? {} : { maxHeight: node.maxHeight }),
      };
      return {
        ...common,
        type: "card",
        dragHandle: `.${canvasClasses.dragHandle}`,
        data: { ...data, content: params.renderCard(item) },
        style: { width: css(node.width) ?? `${box.width}px` },
      };
    }
    return { ...common, type: "simple", data, style: { width: box.width, height: box.height } };
  });

  for (const shape of params.map.shapes) {
    nodes.push({
      id: `shape:${shape.id}`,
      type: "note",
      position: { x: shape.x, y: shape.y },
      data: { shape, renaming: params.renaming === shape.id, handlers: params.handlers },
      style: { width: shape.width ?? 160, height: shape.height ?? 80 },
      zIndex: -1,
    });
  }
  return { nodes, boxes };
}

function edges(map: ObjectsMap): Edge[] {
  return map.relations.map((relation) => ({
    id: relation.id,
    source: relation.from,
    target: relation.to,
    ...(relation.label === undefined ? {} : { label: relation.label }),
    data: { relation },
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "var(--mw-foreground)", opacity: relation.count > 1 ? 0.7 : 0.5 },
    labelStyle: { fill: "var(--mw-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--mw-editor-background)" },
  }));
}

export type GraphProps = {
  map: ObjectsMap;
  viewport?: Viewport | undefined;
  tool: Tool;
  renaming: string | undefined;
  onOpenTab?: ((link: string) => void) | undefined;
  onViewport: (viewport: Viewport) => void;
  /** Операция на отпускание узла; `false` — сервер отказал, и узел возвращается на место. */
  onEdit: (ops: MapOp[]) => Promise<boolean>;
  onPopover: (popover: Popover | undefined) => void;
  onRename: (id: string | undefined) => void;
  onDelete: (target: Deletable) => void;
  onSay: (message: string) => void;
  onToolDone: () => void;
  onUndo: () => void;
  onRedo: () => void;
  renderCard: (item: ObjectRef) => ReactNode;
};

/** Уникальный номер фигуры: пометки живут в файле вьюхи и должны различаться между собой. */
const shapeId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Canvas(props: GraphProps) {
  const flow = useReactFlow();
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const view = props.map.view;

  const handlers: Handlers = {
    commit: (id, text) => {
      props.onRename(undefined);
      const value = text.trim();
      const shape = props.map.shapes.find((item) => item.id === id);
      if (shape) {
        if (value !== (shape.text ?? ""))
          void props.onEdit([{ op: "put-shape", view, shape: { ...shape, text: value } }]);
        return;
      }
      const node = props.map.nodes.find((item) => item.id === id);
      if (node && value && value !== node.label) {
        void props.onEdit([{ op: "rename", object: id, label: value, view }]);
      }
    },
    cancel: () => props.onRename(undefined),
    expand: (id, expanded) =>
      void props.onEdit([{ op: "set-expanded", view, object: id, expanded }]),
    preview: (id) => props.onPopover({ kind: "object", address: id }),
  };

  const params = (lit: string | undefined): Build => ({
    map: props.map,
    renaming: props.renaming,
    connecting: props.tool.kind === "relation",
    highlight: lit,
    handlers,
    renderCard: props.renderCard,
  });

  const [nodes, setNodes] = useState<Node[]>(() => build(params(undefined)).nodes);
  const restore = () => setNodes(build(params(undefined)).nodes);

  // Новое значение вьюхи — новая картинка: позиции у сервера, холст их не держит сам.
  useEffect(() => {
    setNodes(build(params(highlight)).nodes);
    // oxlint-disable-next-line exhaustive-deps
  }, [props.map, props.renaming, props.tool.kind, highlight]);

  /** Развёрнутые группы прямоугольниками на холсте целиком — для «куда падает узел». */
  const groups = (): Rect[] =>
    props.map.nodes
      .filter((node) => node.expanded)
      .map((node) => {
        const internal = flow.getInternalNode(node.id);
        const at = internal?.internals.positionAbsolute ?? { x: 0, y: 0 };
        return {
          id: node.id,
          x: at.x,
          y: at.y,
          width: internal?.measured.width ?? 0,
          height: internal?.measured.height ?? 0,
        };
      });

  const where = (node: Node) => {
    const internal = flow.getInternalNode(node.id);
    const at = internal?.internals.positionAbsolute ?? node.position;
    const center = {
      x: at.x + (internal?.measured.width ?? 0) / 2,
      y: at.y + (internal?.measured.height ?? 0) / 2,
    };
    const target = dropTarget({ node: node.id, center, parent: node.parentId, groups: groups() });
    return { at, target };
  };

  const relativeTo = (target: string | undefined, point: Point): Point => {
    if (target === undefined) return point;
    const base = flow.getInternalNode(target)?.internals.positionAbsolute ?? { x: 0, y: 0 };
    return { x: point.x - base.x, y: point.y - base.y };
  };

  const dragStop = async (dragged: Node, all: Node[]) => {
    setHighlight(undefined);
    if (dragged.type === "note") {
      const shapes = all.filter((node) => node.type === "note");
      const ops: MapOp[] = shapes.map((node) => ({
        op: "put-shape",
        view,
        shape: { ...(node.data as NoteData).shape, x: node.position.x, y: node.position.y },
      }));
      if (!(await props.onEdit(ops))) restore();
      return;
    }
    const objects = all.filter((node) => node.type !== "note");
    // Несколько узлов разом — только сдвиг: переносить пачку папок одним жестом слишком легко.
    if (objects.length > 1) {
      const positions = Object.fromEntries(objects.map((node) => [node.id, node.position]));
      if (!(await props.onEdit([{ op: "move-nodes", view, positions }]))) restore();
      return;
    }
    const { at, target } = where(dragged);
    const node = (dragged.data as ObjectData).node;
    const op = dropOp({
      view,
      node: dragged.id,
      kind: node.kind,
      parent: dragged.parentId,
      target,
      position: relativeTo(target, at),
      stay: dragged.position,
    });
    if (!(await props.onEdit([op]))) restore();
  };

  const place = (event: { clientX: number; clientY: number }) => {
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const parent = dropTarget({ node: "", center: point, parent: undefined, groups: groups() });
    const tool = props.tool;
    if (tool.kind === "shape") {
      const size = tool.shape === "text" ? { width: 160, height: 32 } : { width: 160, height: 80 };
      const shape = {
        id: shapeId(),
        kind: tool.shape,
        x: point.x,
        y: point.y,
        ...size,
        text: tool.shape === "text" ? "текст" : "",
      };
      void props.onEdit([{ op: "put-shape", view, shape }]);
      props.onToolDone();
      return;
    }
    if (tool.kind === "object") {
      if (parent === undefined && !props.map.canPlaceObjects) {
        props.onSay(
          "Здесь создавать нельзя: у вьюхи не названо место для новых объектов — брось на группу",
        );
        return;
      }
      const name =
        props.map.palette.objects.find((item) => item.prototype === tool.prototype)?.label ??
        "Новый объект";
      void props.onEdit([
        {
          op: "create-object",
          view,
          name,
          prototype: tool.prototype,
          ...(parent === undefined ? {} : { parent }),
          position: relativeTo(parent, point),
        },
      ]);
      props.onToolDone();
      return;
    }
    props.onPopover(undefined);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) props.onRedo();
      else props.onUndo();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const selected = nodes.find((node) => node.selected);
    if (!selected) return;
    event.preventDefault();
    if (selected.type === "note") {
      const shape = (selected.data as NoteData).shape;
      props.onDelete({ kind: "shape", id: shape.id, label: shape.text || "фигура" });
      return;
    }
    const node = (selected.data as ObjectData).node;
    props.onDelete({ kind: node.kind, id: node.id, label: node.label });
  };

  return (
    // Клавиши ловит обёртка: холсту нужен фокус, чтобы Delete и Ctrl+Z не ушли в редактор.
    // oxlint-disable-next-line no-noninteractive-tabindex
    <div className="h-full min-h-40 w-full outline-none" tabIndex={0} onKeyDown={key}>
      <ReactFlow
        nodes={nodes}
        edges={edges(props.map)}
        nodeTypes={NODE_TYPES}
        // Узел за краем холста не рисуется — и его карточка не подписана на метрики.
        onlyRenderVisibleElements
        deleteKeyCode={null}
        onNodesChange={(changes: NodeChange[]) => setNodes((now) => applyNodeChanges(changes, now))}
        onNodeDrag={(_, node) => {
          if (node.type === "note") return;
          const { target } = where(node);
          if (target !== highlight) setHighlight(target === node.parentId ? undefined : target);
        }}
        onNodeDragStop={(_, node, all) => void dragStop(node, all)}
        onConnect={(connection) => {
          if (props.tool.kind !== "relation") return;
          if (!props.map.canPlaceRelations) {
            props.onSay("Стрелку провести нельзя: у вьюхи не названо место для новых связей");
            return;
          }
          void props.onEdit([
            {
              op: "create-relation",
              view,
              from: connection.source,
              to: connection.target,
              prototype: props.tool.prototype,
            },
          ]);
        }}
        onPaneClick={place}
        onNodeClick={(event, node) => {
          if (node.type === "note") return;
          const data = node.data as ObjectData;
          if ((event.ctrlKey || event.metaKey) && props.onOpenTab) {
            props.onOpenTab(data.node.object);
            return;
          }
          // У полного превью метрики и так на холсте, а «провалиться» — имя в его шапке.
          if (node.type === "simple")
            props.onPopover({ kind: "object", address: data.node.object });
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === "note") props.onRename((node.data as NoteData).shape.id);
          else if (node.type !== "card") props.onRename(node.id);
        }}
        onEdgeClick={(_, edge) => {
          const relation = (edge.data as { relation: ObjectsMap["relations"][number] }).relation;
          if (relation.count > 1) props.onPopover({ kind: "relations", items: relation.relations });
          else if (relation.link) props.onPopover({ kind: "object", address: relation.link });
        }}
        defaultViewport={props.viewport}
        fitView={!props.viewport}
        proOptions={{ hideAttribution: true }}
        onMoveEnd={(_, viewport) => props.onViewport(viewport)}
      >
        <Background gap={16} size={1} color="var(--mw-panel-border, #8883)" />
      </ReactFlow>
    </div>
  );
}

export function Graph(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
