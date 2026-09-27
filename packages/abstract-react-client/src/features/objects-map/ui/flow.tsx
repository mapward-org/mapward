import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  BaseEdge,
  type Edge,
  type EdgeChange,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  NodeResizer,
  NodeToolbar,
  type ResizeParams,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useReactFlow,
  useViewport,
  type Viewport,
} from "@xyflow/react";
import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type {
  LineEnd,
  MapOp,
  ObjectRef,
  ObjectsMap,
  Point,
  ViewNode,
  ArrowStyle,
  ViewRelation,
  ViewShape,
} from "@mapward/core";
import { canvasClasses } from "../../../lib/ui/canvas-classes.ts";
import { tabHover } from "../../../lib/ui/tab-hover.ts";
import type { Deletable, Popover, Tool } from "../pure-model/tools.ts";
import { dropOp, dropTarget, type Rect } from "../pure-model/drop.ts";
import { layout, type Box } from "../pure-model/layout.ts";
import { DRAFT_ID, lineEnd, type Draft } from "../pure-model/edit.ts";
import { handles, routePath, type Route } from "../pure-model/route.ts";
import { center as middle, endPoint, snapToFrame, type Frame } from "../pure-model/anchors.ts";

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
  /** Фигуру потянули за ручку: новые угол и размер. */
  resize: (id: string, box: ResizeParams) => void;
  /**
   * Узел объекта потянули за ручку: новый размер и, если тянули за левый или верхний край, место.
   * С `scale` — это ручка масштаба: содержимое растёт вместе с узлом.
   */
  resizeNode: (id: string, box: ResizeParams, scale?: number) => void;
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
  // Связь тянется с любой стороны: холст в свободном режиме, любая точка — и начало, и конец.
  // Где стрелка коснётся узла потом, решают плавающие концы, а не эти точки.
  return (
    <>
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={side}
          style={style}
          isConnectable={props.connecting}
        />
      ))}
    </>
  );
}

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/**
 * Подпись, которую правят на месте: поле без состояния React, значение берётся на Enter, а
 * Shift+Enter переносит строку — подпись бывает в несколько строк. Выравнивание и шрифт — от
 * подписи: поле ввода по умолчанию прижимает текст влево, и подпись на время правки прыгала бы.
 */
function Label(props: { text: string; renaming: boolean; id: string; handlers: Handlers }) {
  if (!props.renaming) {
    return <span className="block whitespace-pre-wrap break-words">{props.text}</span>;
  }
  const done = (value: string) => props.handlers.commit(props.id, value);
  return (
    <textarea
      className="nodrag nowheel block w-full resize-none bg-transparent text-inherit outline-none"
      style={{
        textAlign: "inherit",
        font: "inherit",
        letterSpacing: "inherit",
        fieldSizing: "content",
      }}
      rows={1}
      autoFocus
      defaultValue={props.text}
      onBlur={(event) => done(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          done(event.currentTarget.value);
        }
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

/**
 * Содержимое в масштабе: раскладывается в узле, уменьшенном на масштаб, и растягивается
 * transform-ом обратно — узел больше, и всё в нём крупнее, а не просто больше места.
 */
function Scaled(props: { scale: number; fill?: boolean; children: ReactNode }) {
  const share = `${100 / props.scale}%`;
  return (
    <div
      className={`h-full w-full ${props.fill ? "[&>[data-card-frame]]:h-full [&>[data-card-frame]]:max-h-none" : ""}`}
      style={
        props.scale === 1
          ? {}
          : {
              width: share,
              height: share,
              transform: `scale(${props.scale})`,
              transformOrigin: "0 0",
            }
      }
    >
      {props.children}
    </div>
  );
}

/**
 * Ручка масштаба ⤡ у правого нижнего угла выделенного узла, вынесенная наружу по диагонали: на
 * самом углу стоит ручка растяжения, и они не должны перекрываться. Тянешь — узел и его
 * содержимое растут вместе, пропорционально. Отпускание — одна правка размера с масштабом.
 */
function ScaleHandle(props: {
  id: string;
  scale: number;
  onLive: (scale: number | undefined) => void;
  onDone: (box: ResizeParams, scale: number) => void;
}) {
  const flow = useReactFlow();
  const begin = (event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const internal = flow.getInternalNode(props.id);
    const width = internal?.measured.width ?? 0;
    const height = internal?.measured.height ?? 0;
    const origin = internal?.position ?? { x: 0, y: 0 };
    if (!width || !height) return;
    const startX = event.clientX;
    let factor = 1;
    const move = (next: PointerEvent) => {
      const zoom = flow.getZoom();
      factor = Math.max(0.25, (width + (next.clientX - startX) / zoom) / width);
      flow.updateNode(props.id, (node) => ({
        style: { ...node.style, width: width * factor, height: height * factor },
      }));
      props.onLive(props.scale * factor);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      props.onLive(undefined);
      const box = { x: origin.x, y: origin.y, width: width * factor, height: height * factor };
      props.onDone(box, Number((props.scale * factor).toFixed(3)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <button
      type="button"
      title="Масштаб: тяни — узел и его содержимое растут вместе"
      className="nodrag nopan absolute -right-8 -bottom-8 z-10 h-4 w-4 cursor-nwse-resize rounded-sm border text-[9px] leading-none"
      style={{
        background: "var(--mw-editor-background)",
        color: "var(--mw-focus-border, #3794ff)",
      }}
      onPointerDown={begin}
    >
      ⤡
    </button>
  );
}

/** Простая карточка — фигура нужной формы и цвета с подписью. Ссылка обведена пунктиром. */
function SimpleNode(props: NodeProps<Node<ObjectData>>) {
  const { node, handlers } = props.data;
  const [live, setLive] = useState<number | undefined>(undefined);
  const scale = live ?? node.size?.scale ?? 1;
  return (
    <div
      className="relative h-full w-full"
      style={{
        ...SHAPES[node.shape],
        background: node.color ?? "var(--mw-editor-background)",
        color: "var(--mw-foreground)",
        border: `1px ${node.kind === "ref" ? "dashed" : "solid"} ${
          props.selected ? "var(--mw-focus-border, #3794ff)" : frame
        }`,
        outline: props.selected ? "1px solid var(--mw-focus-border, #3794ff)" : "none",
      }}
    >
      <NodeResizer
        isVisible={props.selected}
        minWidth={40}
        minHeight={24}
        color="var(--mw-focus-border, #3794ff)"
        onResizeEnd={(_, box) => handlers.resizeNode(node.id, box)}
      />
      <Ends connecting={props.data.connecting} />
      <Scaled scale={scale}>
        <div
          className="flex h-full w-full items-center gap-1 px-2 text-[11px]"
          style={node.textColor ? { color: node.textColor } : {}}
        >
          {node.kind === "ref" && <span title="Ссылка на чужой объект">↗</span>}
          <div className={`min-w-0 flex-1 text-center ${tabHover.tabOnly}`}>
            <Label
              text={node.label}
              renaming={props.data.renaming}
              id={node.id}
              handlers={handlers}
            />
          </div>
          <ExpandButton node={node} handlers={handlers} />
        </div>
      </Scaled>
      {props.selected && (
        <ScaleHandle
          id={node.id}
          scale={node.size?.scale ?? 1}
          onLive={setLive}
          onDone={(box, next) => handlers.resizeNode(node.id, box, next)}
        />
      )}
    </div>
  );
}

/** Полное превью — карточка объекта; её рисует своя фича, сюда она приходит готовой. */
function CardNode(props: NodeProps<Node<ObjectData>>) {
  const { node, handlers } = props.data;
  const [live, setLive] = useState<number | undefined>(undefined);
  const scale = live ?? node.size?.scale ?? 1;
  return (
    <div
      className="relative h-full"
      style={
        props.selected
          ? { outline: "2px solid var(--mw-focus-border, #3794ff)", outlineOffset: 1 }
          : node.kind === "ref"
            ? { outline: `1px dashed ${frame}` }
            : {}
      }
    >
      <NodeResizer
        isVisible={props.selected}
        minWidth={160}
        minHeight={60}
        color="var(--mw-focus-border, #3794ff)"
        onResizeEnd={(_, box) => handlers.resizeNode(node.id, box)}
      />
      <Ends connecting={props.data.connecting} />
      {/* Растянутое руками превью заполняет узел целиком: область метрик тянется и прокручивается. */}
      <Scaled scale={scale} fill={node.size !== undefined}>
        {props.data.content}
      </Scaled>
      {node.expandable && (
        <div className="absolute right-1 bottom-1">
          <ExpandButton node={node} handlers={handlers} />
        </div>
      )}
      {props.selected && (
        <ScaleHandle
          id={node.id}
          scale={node.size?.scale ?? 1}
          onLive={setLive}
          onDone={(box, next) => handlers.resizeNode(node.id, box, next)}
        />
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
      {/* Цветная группа — цветная шапка с читаемой на ней подписью. */}
      <div
        className={`flex items-center gap-1 rounded-t-md px-2 py-1 ${canvasClasses.dragHandle}`}
        style={
          node.color
            ? { background: node.color, color: node.textColor ?? "var(--mw-foreground)" }
            : {}
        }
      >
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
  const text = shape.kind === "text";
  const line = props.selected ? "var(--mw-focus-border, #3794ff)" : (shape.stroke ?? frame);
  return (
    <>
      <NodeResizer
        isVisible={props.selected}
        minWidth={24}
        minHeight={16}
        color="var(--mw-focus-border, #3794ff)"
        onResizeEnd={(_, box) => handlers.resize(shape.id, box)}
      />
      <Ends connecting={false} />
      <div
        className="flex h-full w-full items-center justify-center p-1"
        style={{
          border: text && !props.selected ? "none" : `1px ${text ? "dashed" : "solid"} ${line}`,
          borderRadius: shape.kind === "ellipse" ? "50%" : 2,
          background: shape.color ?? "transparent",
          color: shape.textColor ?? "var(--mw-foreground)",
          fontSize: shape.fontSize ?? 11,
        }}
      >
        <Label
          text={shape.text ?? ""}
          renaming={props.data.renaming}
          id={shape.id}
          handlers={handlers}
        />
      </div>
    </>
  );
}

/** Свободный конец линии — точка на холсте; её тащат, и конец переезжает. */
function AnchorNode(props: NodeProps<Node<{ line: string }>>) {
  return (
    <div
      className="h-2 w-2 rounded-full"
      style={{
        background: props.selected ? "var(--mw-focus-border, #3794ff)" : "var(--mw-foreground)",
        opacity: 0.6,
      }}
    >
      <Ends connecting={false} />
    </div>
  );
}

const NODE_TYPES = {
  simple: SimpleNode,
  card: CardNode,
  group: GroupNode,
  note: NoteNode,
  anchor: AnchorNode,
};

/** Id узла холста для того, к чему прицеплен конец линии: фигура живёт под своим префиксом. */
function endNode(map: ObjectsMap, end: LineEnd | undefined): string | undefined {
  if (!end || !("node" in end)) return undefined;
  if (map.shapes.some((shape) => shape.id === end.node)) return `shape:${end.node}`;
  return map.nodes.some((node) => node.id === end.node) ? end.node : undefined;
}

const anchorId = (line: string, side: "from" | "to") => `anchor:${line}:${side}`;

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
      // Черновик брошенной карточки сразу с полем подписи: Enter создаёт, Esc убирает.
      renaming: params.renaming === node.id || node.id === DRAFT_ID,
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
      // Размер, растянутый руками, перекрывает ширину и потолок из стиля вьюхи.
      const width = node.size?.width ?? node.width;
      const height = node.size?.height ?? node.maxHeight;
      // Растянутая карточка занимает весь узел, а не свою высоту: размер задаёт узел.
      const item: ObjectRef = {
        object: node.object,
        ...(node.group === undefined ? {} : { group: node.group }),
        ...(node.size ? { width: "100%" } : width === undefined ? {} : { width }),
        ...(node.size || height === undefined ? {} : { maxHeight: height }),
      };
      return {
        ...common,
        type: "card",
        dragHandle: `.${canvasClasses.dragHandle}`,
        data: { ...data, content: params.renderCard(item) },
        style: {
          width: css(width) ?? `${box.width}px`,
          ...(node.size ? { height: node.size.height } : {}),
        },
      };
    }
    return { ...common, type: "simple", data, style: { width: box.width, height: box.height } };
  });

  for (const shape of params.map.shapes) {
    if (shape.kind === "line") {
      // Свободный конец — точка-узел, за которую его тащат; прицепленный едет за своим узлом.
      for (const side of ["from", "to"] as const) {
        const end = shape[side];
        if (!end || "node" in end) continue;
        nodes.push({
          id: anchorId(shape.id, side),
          type: "anchor",
          position: { x: end.x, y: end.y },
          data: { line: shape.id },
          style: { width: 8, height: 8 },
        });
      }
      continue;
    }
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

const MARK = { type: MarkerType.ArrowClosed };

/** Конец линии как узел холста: прицепленный — его узел, свободный — точка; нет — `undefined`. */
function lineSide(map: ObjectsMap, line: string, end: LineEnd | undefined, side: "from" | "to") {
  if (!end) return undefined;
  return "node" in end ? endNode(map, end) : anchorId(line, side);
}

function lineEdges(map: ObjectsMap): Edge[] {
  const out: Edge[] = [];
  for (const shape of map.shapes) {
    if (shape.kind !== "line") continue;
    const source = lineSide(map, shape.id, shape.from, "from");
    const target = lineSide(map, shape.id, shape.to, "to");
    // Конец прицеплен к узлу, которого на холсте больше нет, — линии не к чему идти.
    if (!source || !target) continue;
    const arrow = shape.arrow ?? "end";
    const color = shape.stroke ?? "var(--mw-foreground)";
    const head = { ...MARK, color };
    out.push({
      id: `line:${shape.id}`,
      source,
      target,
      type: "line",
      ...(shape.text ? { label: shape.text } : {}),
      ...(arrow === "none" ? {} : { markerEnd: head }),
      ...(arrow === "both" ? { markerStart: head } : {}),
      data: {
        route: shape.route ?? "straight",
        textColor: shape.textColor,
        fontSize: shape.fontSize,
      },
      style: { stroke: color, strokeWidth: shape.strokeWidth ?? 1.5 },
    });
  }
  return out;
}

/** Подпись стрелки — просто текст, без плашки; лёгкая тень держит её читаемой поверх линий. */
function EdgeText(props: {
  at: Point;
  text: ReactNode;
  color?: string | undefined;
  size?: number | undefined;
}) {
  return (
    <div
      className="nodrag nopan whitespace-nowrap"
      style={{
        ...placed(props.at),
        pointerEvents: "none",
        color: props.color ?? "var(--mw-foreground)",
        fontSize: props.size ?? 10,
        textShadow: "0 0 3px var(--mw-editor-background), 0 0 3px var(--mw-editor-background)",
      }}
    >
      {props.text}
    </div>
  );
}

type BentData = {
  relation: ViewRelation;
  onBends: (id: string, bends: Point[]) => void;
  /** Стиль стрелки поверх прежнего — так переносят и отпускают концы. */
  onStyle: (id: string, patch: Partial<ArrowStyle>) => void;
};

/** Рамка узла на холсте целиком — из того, как его измерила библиотека. */
function frameOf(node: ReturnType<typeof useInternalNode>): Frame | undefined {
  if (!node) return undefined;
  const at = node.internals.positionAbsolute;
  return {
    x: at.x,
    y: at.y,
    width: node.measured.width ?? 0,
    height: node.measured.height ?? 0,
  };
}

const placed = (point: Point): CSSProperties => ({
  position: "absolute",
  transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
  pointerEvents: "all",
});

/**
 * Связь с изломами: путь идёт отрезками через точки излома. У выделенной стрелки видны точки и
 * середины отрезков: середину тянут — появляется новая точка, точку тянут — она едет, двойной
 * клик по точке её убирает. Отпускание — одна операция «изломы стрелки».
 */
function BentEdge(props: EdgeProps<Edge<BentData>>) {
  const flow = useReactFlow();
  const [drag, setDrag] = useState<Point[] | undefined>(undefined);
  const [pull, setPull] = useState<{ side: "from" | "to"; point: Point } | undefined>(undefined);
  const relation = props.data?.relation;
  const bends = drag ?? relation?.bends ?? [];
  const style = relation?.style;
  // Концы — по рамкам узлов: плавающие смотрят на соседнюю точку пути, закреплённые — в свою долю.
  const sourceFrame = frameOf(useInternalNode(props.source));
  const targetFrame = frameOf(useInternalNode(props.target));
  const fallbackFrom = { x: props.sourceX, y: props.sourceY };
  const fallbackTo = { x: props.targetX, y: props.targetY };
  const towardTo = bends[0] ?? (targetFrame ? middle(targetFrame) : fallbackTo);
  const towardFrom = bends.at(-1) ?? (sourceFrame ? middle(sourceFrame) : fallbackFrom);
  const from =
    pull?.side === "from"
      ? pull.point
      : sourceFrame
        ? endPoint(sourceFrame, style?.fromAnchor, towardTo)
        : fallbackFrom;
  const to =
    pull?.side === "to"
      ? pull.point
      : targetFrame
        ? endPoint(targetFrame, style?.toAnchor, towardFrom)
        : fallbackTo;
  const points = [from, ...bends, to];

  /** Конец тянут по рамке своего узла; отпускание закрепляет его там. */
  const pullEnd = (event: ReactPointerEvent, side: "from" | "to") => {
    const own = side === "from" ? sourceFrame : targetFrame;
    if (!own) return;
    const box = own;
    event.stopPropagation();
    event.preventDefault();
    let anchor = snapToFrame(
      box,
      flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
    const move = (next: PointerEvent) => {
      anchor = snapToFrame(box, flow.screenToFlowPosition({ x: next.clientX, y: next.clientY }));
      setPull({
        side,
        point: { x: box.x + box.width * anchor.x, y: box.y + box.height * anchor.y },
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      props.data?.onStyle(
        props.id,
        side === "from" ? { fromAnchor: anchor } : { toAnchor: anchor },
      );
      setPull(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const path = routePath(points, style?.route ?? "straight");
  // Ручка «создать излом» — на трети отрезка, подпись — на середине: друг друга не закрывают.
  const { label, inserts } = handles(points);

  const start = (event: ReactPointerEvent, index: number, insert: boolean) => {
    event.stopPropagation();
    event.preventDefault();
    const first = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    let current = insert
      ? [...bends.slice(0, index), first, ...bends.slice(index)]
      : bends.map((bend) => ({ ...bend }));
    const move = (next: PointerEvent) => {
      const point = flow.screenToFlowPosition({ x: next.clientX, y: next.clientY });
      current = current.map((bend, i) => (i === index ? point : bend));
      setDrag(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      props.data?.onBends(props.id, current);
      setDrag(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    setDrag(current);
  };

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        {...(props.markerEnd === undefined ? {} : { markerEnd: props.markerEnd })}
        style={{
          ...props.style,
          ...(props.selected ? { stroke: "var(--mw-focus-border, #3794ff)", opacity: 1 } : {}),
        }}
      />
      <EdgeLabelRenderer>
        {props.label !== undefined && label && (
          <EdgeText at={label} text={props.label} color={style?.textColor} size={style?.fontSize} />
        )}
        {props.selected &&
          (["from", "to"] as const).map((side) => (
            <div
              key={side}
              title="Тяни — конец встанет в эту точку рамки; двойной клик — снова плавающий"
              className="nodrag nopan h-3 w-3 cursor-grab rounded-full border-2"
              style={{
                ...placed(side === "from" ? from : to),
                background: "var(--mw-editor-background)",
                borderColor: "var(--mw-focus-border, #3794ff)",
              }}
              onPointerDown={(event) => pullEnd(event, side)}
              onDoubleClick={() =>
                props.data?.onStyle(
                  props.id,
                  side === "from" ? { fromAnchor: undefined } : { toAnchor: undefined },
                )
              }
            />
          ))}
        {props.selected &&
          bends.map((bend, i) => (
            <div
              key={`b${i}`}
              title="Тяни — точка едет; двойной клик — убрать"
              className="nodrag nopan h-2.5 w-2.5 cursor-move rounded-full border"
              style={{ ...placed(bend), background: "var(--mw-focus-border, #3794ff)" }}
              onPointerDown={(event) => start(event, i, false)}
              onDoubleClick={() =>
                props.data?.onBends(
                  props.id,
                  bends.filter((_, k) => k !== i),
                )
              }
            />
          ))}
        {props.selected &&
          inserts.map((insert, i) => (
            <div
              key={`m${i}`}
              title="Тяни — стрелка изломится здесь"
              className="nodrag nopan h-2 w-2 cursor-crosshair border opacity-70"
              style={{ ...placed(insert), background: "var(--mw-editor-background)" }}
              onPointerDown={(event) => start(event, i, true)}
            />
          ))}
      </EdgeLabelRenderer>
    </>
  );
}

type LineData = { route: Route; textColor?: string | undefined; fontSize?: number | undefined };

/** Линия-пометка: выделенная толще и цветом фокуса, на концах — точки. */
function LineEdge(props: EdgeProps<Edge<LineData>>) {
  const ends = [
    { x: props.sourceX, y: props.sourceY },
    { x: props.targetX, y: props.targetY },
  ];
  const path = routePath(ends, props.data?.route ?? "straight");
  const { label } = handles(ends);
  const width = Number(props.style?.strokeWidth ?? 1.5);
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        {...(props.markerEnd === undefined ? {} : { markerEnd: props.markerEnd })}
        {...(props.markerStart === undefined ? {} : { markerStart: props.markerStart })}
        interactionWidth={16}
        style={{
          ...props.style,
          ...(props.selected
            ? { stroke: "var(--mw-focus-border, #3794ff)", strokeWidth: width + 1.5 }
            : {}),
        }}
      />
      <EdgeLabelRenderer>
        {props.label !== undefined && label && (
          <EdgeText
            at={label}
            text={props.label}
            color={props.data?.textColor}
            size={props.data?.fontSize}
          />
        )}
        {props.selected &&
          ends.map((end, i) => (
            <div
              key={i}
              className="nodrag nopan h-2.5 w-2.5 rounded-full border"
              style={{
                ...placed(end),
                pointerEvents: "none",
                background: "var(--mw-focus-border, #3794ff)",
              }}
            />
          ))}
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { bent: BentEdge, line: LineEdge };

/** Направление связи видно издалека: крупный закрытый наконечник цвета стрелки. */
const HEAD = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "var(--mw-foreground)" };

function edges(
  map: ObjectsMap,
  onBends: BentData["onBends"],
  onStyle: BentData["onStyle"],
): Edge[] {
  return [
    ...map.relations.map((relation): Edge => ({
      id: relation.id,
      type: "bent",
      source: relation.from,
      target: relation.to,
      ...(relation.label === undefined ? {} : { label: relation.label }),
      data: { relation, onBends, onStyle },
      markerEnd: { ...HEAD, color: relation.style?.stroke ?? HEAD.color },
      style: {
        stroke: relation.style?.stroke ?? "var(--mw-foreground)",
        strokeWidth: relation.style?.strokeWidth ?? (relation.count > 1 ? 2 : 1.5),
        opacity: 0.85,
      },
    })),
    ...lineEdges(map),
  ];
}

/**
 * Меню у стрелки — у середины её пути, над ней. Слой подписей стрелок масштабируется вместе с
 * холстом, поэтому меню сжато обратно на масштаб: остаётся своего размера, как у узлов.
 */
function EdgePin(props: { at: Point; side: "top" | "right"; children: ReactNode }) {
  const { zoom } = useViewport();
  const shift =
    props.side === "top" ? "translate(-50%, calc(-100% - 12px))" : "translate(16px, -50%)";
  return (
    <EdgeLabelRenderer>
      <div
        className="nodrag nopan"
        style={{
          position: "absolute",
          transform: `translate(${props.at.x}px, ${props.at.y}px) scale(${1 / zoom}) ${shift}`,
          transformOrigin: "0 0",
          pointerEvents: "all",
          zIndex: 1000,
        }}
      >
        {props.children}
      </div>
    </EdgeLabelRenderer>
  );
}

/** Подсказка у курсора: что сделает клик выбранным инструментом. */
function CursorHint(props: { at: Point; text: string }) {
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-md border px-1.5 py-0.5 text-[10px] whitespace-nowrap"
      style={{
        left: props.at.x + 14,
        top: props.at.y + 14,
        background: "var(--mw-editor-background)",
        borderColor: "var(--mw-panel-border, #8884)",
        color: "var(--mw-foreground)",
      }}
    >
      {props.text}
    </div>
  );
}

/** Выделение живёт в холсте: пересобранные узлы и стрелки его не теряют. */
function keepSelected<T extends { id: string; selected?: boolean }>(built: T[], now: T[]): T[] {
  const chosen = new Set(now.filter((item) => item.selected).map((item) => item.id));
  return chosen.size === 0
    ? built
    : built.map((item) => (chosen.has(item.id) ? { ...item, selected: true } : item));
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
  /** Карточка брошена: черновик с полем подписи, операции ещё нет. */
  onPlace: (draft: Draft) => void;
  /** Enter в подписи черновика — имя; пустое — как Esc. */
  onDraft: (name: string) => void;
  onDraftCancel: () => void;
  /** Выделена одна фигура или линия — над ней панель стиля; иначе ничего. */
  onSelect: (chosen: { kind: "shape" | "arrow" | "object"; id: string } | undefined) => void;
  /** Esc на холсте: закрыть выпадашку, потом поповер. */
  onEscape: () => void;
  /** Подсказка у курсора, пока выбран инструмент, который ставит кликом. */
  hint?: string | undefined;
  /** Клик с инструментом «линия»: её начало или конец. */
  onLine: (end: LineEnd) => void;
  /**
   * Меню, пристёгнутые к узлам холста: поповер и панель стиля стоят рядом с объектом и едут за
   * зумом и сдвигом. Что положить, решает compose.
   */
  pinned?:
    | {
        node?: string | undefined;
        edge?: string | undefined;
        side: "top" | "right";
        content: ReactNode;
      }[]
    | undefined;
  renderCard: (item: ObjectRef) => ReactNode;
};

/** Уникальный номер фигуры: пометки живут в файле вьюхи и должны различаться между собой. */
const shapeId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Фигура узла холста; у линии узлов нет — только её свободные концы. */
const shapeOf = (map: ObjectsMap, flowId: string) =>
  flowId.startsWith("shape:")
    ? map.shapes.find((shape) => `shape:${shape.id}` === flowId)
    : undefined;

/** Выделена ровно одна фигура или одна линия — её id для панели стиля. */
function picked(
  map: ObjectsMap,
  nodes: Node[],
  lines: Edge[],
): { kind: "shape" | "arrow" | "object"; id: string } | undefined {
  if (nodes.length === 1 && lines.length === 0) {
    const id = nodes[0]?.id ?? "";
    const shape = shapeOf(map, id);
    if (shape) return { kind: "shape", id: shape.id };
    return map.nodes.some((node) => node.id === id) ? { kind: "object", id } : undefined;
  }
  const edge = nodes.length === 0 && lines.length === 1 ? lines[0]?.id : undefined;
  if (edge === undefined) return undefined;
  if (edge.startsWith("line:")) return { kind: "shape", id: edge.slice("line:".length) };
  return map.relations.some((arrow) => arrow.id === edge) ? { kind: "arrow", id: edge } : undefined;
}

function Canvas(props: GraphProps) {
  const flow = useReactFlow();
  const [cursor, setCursor] = useState<Point | undefined>(undefined);

  /**
   * Середина пути стрелки или линии — туда встаёт её панель и поповер. Считается так же, как
   * рисуется путь: концы по рамкам узлов (плавающие или закреплённые), изломы между ними.
   */
  const middleOf = (edge: string): Point => {
    const boxOf = (id: string) => {
      const node = flow.getInternalNode(id);
      return node
        ? {
            x: node.internals.positionAbsolute.x,
            y: node.internals.positionAbsolute.y,
            width: node.measured.width ?? 0,
            height: node.measured.height ?? 0,
          }
        : undefined;
    };
    const line = edge.startsWith("line:")
      ? props.map.shapes.find((shape) => `line:${shape.id}` === edge)
      : undefined;
    if (line) {
      const end = (value: LineEnd | undefined) => {
        if (!value) return { x: 0, y: 0 };
        if (!("node" in value)) return value;
        const box = boxOf(value.node) ?? boxOf(`shape:${value.node}`);
        return box ? middle(box) : { x: 0, y: 0 };
      };
      const a = end(line.from);
      const b = end(line.to);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    const arrow = props.map.relations.find((item) => item.id === edge);
    const from = arrow && boxOf(arrow.from);
    const to = arrow && boxOf(arrow.to);
    if (!arrow || !from || !to) return { x: 0, y: 0 };
    const bends = arrow.bends ?? [];
    const start = endPoint(from, arrow.style?.fromAnchor, bends[0] ?? middle(to));
    const finish = endPoint(to, arrow.style?.toAnchor, bends.at(-1) ?? middle(from));
    return handles([start, ...bends, finish]).label ?? start;
  };
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const view = props.map.view;

  const handlers: Handlers = {
    commit: (id, text) => {
      if (id === DRAFT_ID) {
        props.onDraft(text);
        return;
      }
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
    cancel: () => {
      props.onRename(undefined);
      props.onDraftCancel();
    },
    expand: (id, expanded) =>
      void props.onEdit([{ op: "set-expanded", view, object: id, expanded }]),
    preview: (id) => props.onPopover({ kind: "object", address: id }),
    resize: (id, box) => {
      const shape = props.map.shapes.find((item) => item.id === id);
      if (!shape) return;
      const next = { ...shape, x: box.x, y: box.y, width: box.width, height: box.height };
      void props.onEdit([{ op: "put-shape", view, shape: next }]);
    },
    resizeNode: (id, box, scale) => {
      const kept = scale ?? props.map.nodes.find((item) => item.id === id)?.size?.scale;
      const size = {
        width: Math.round(box.width),
        height: Math.round(box.height),
        ...(kept === undefined || kept === 1 ? {} : { scale: kept }),
      };
      const ops: MapOp[] = [{ op: "resize-nodes", view, sizes: { [id]: size } }];
      const old = props.map.nodes.find((item) => item.id === id)?.position;
      if (old && (Math.abs(old.x - box.x) > 0.5 || Math.abs(old.y - box.y) > 0.5)) {
        ops.push({ op: "move-nodes", view, positions: { [id]: { x: box.x, y: box.y } } });
      }
      void props.onEdit(ops);
    },
  };

  const bend = (id: string, bends: Point[]) =>
    void props.onEdit([{ op: "set-bends", view, arrow: id, bends }]);

  /** Стиль стрелки целиком: прежний, поверх него правка; пустое поле снимается. */
  const restyle = (id: string, patch: Partial<ArrowStyle>) => {
    const arrow = props.map.relations.find((item) => item.id === id);
    const next: Record<string, unknown> = { ...arrow?.style, ...patch };
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
    void props.onEdit([{ op: "style-arrow", view, arrow: id, style: next as ArrowStyle }]);
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
  const [lines, setLines] = useState<Edge[]>(() => edges(props.map, bend, restyle));
  const restore = () => setNodes((now) => keepSelected(build(params(undefined)).nodes, now));

  // Новая картинка — новые узлы. Картинка приходит тем же объектом, пока по содержимому ничего
  // не поменялось (стор сводит снимки подписки к одному), поэтому пересборки без дела нет и
  // выделение с ручками ресайза не слетает посреди жеста.
  useEffect(() => {
    setNodes((now) => keepSelected(build(params(highlight)).nodes, now));
    // oxlint-disable-next-line exhaustive-deps
  }, [props.map, props.renaming, props.tool.kind, highlight]);

  useEffect(() => {
    setLines((now) => keepSelected(edges(props.map, bend, restyle), now));
    // oxlint-disable-next-line exhaustive-deps
  }, [props.map]);

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

  /**
   * Операция уходит раньше, чем гаснет подсветка: её ожидаемый результат ложится на холст в
   * тот же такт, и холст не успевает нарисовать узел на старом месте.
   */
  const send = async (ops: MapOp[]) => {
    const done = props.onEdit(ops);
    setHighlight(undefined);
    if (!(await done)) restore();
  };

  const dragStop = async (dragged: Node, all: Node[]) => {
    if (dragged.type === "anchor") {
      const line = props.map.shapes.find((shape) => dragged.id.startsWith(`anchor:${shape.id}:`));
      if (!line) return;
      const side = dragged.id.endsWith(":from") ? "from" : "to";
      const shape = { ...line, [side]: { x: dragged.position.x, y: dragged.position.y } };
      await send([{ op: "put-shape", view, shape }]);
      return;
    }
    if (dragged.type === "note") {
      const shapes = all.filter((node) => node.type === "note");
      const ops: MapOp[] = shapes.map((node) => ({
        op: "put-shape",
        view,
        shape: { ...(node.data as NoteData).shape, x: node.position.x, y: node.position.y },
      }));
      await send(ops);
      return;
    }
    const objects = all.filter((node) => node.type !== "note" && node.type !== "anchor");
    // Несколько узлов разом — только сдвиг: переносить пачку папок одним жестом слишком легко.
    if (objects.length > 1) {
      const positions = Object.fromEntries(objects.map((node) => [node.id, node.position]));
      await send([{ op: "move-nodes", view, positions }]);
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
    await send([op]);
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
      props.onPlace({
        prototype: tool.prototype,
        ...(parent === undefined ? {} : { parent }),
        position: relativeTo(parent, point),
      });
      return;
    }
    if (tool.kind === "line") {
      props.onLine(lineEnd(point, undefined));
      return;
    }
    props.onPopover(undefined);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      props.onEscape();
      return;
    }
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) props.onRedo();
      else props.onUndo();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const line = lines.find((edge) => edge.selected && edge.id.startsWith("line:"));
    if (line) {
      event.preventDefault();
      props.onDelete({ kind: "shape", id: line.id.slice("line:".length), label: "линия" });
      return;
    }
    const selected = nodes.find((node) => node.selected && node.type !== "anchor");
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
    <div
      className="relative h-full min-h-40 w-full outline-none"
      tabIndex={0}
      onKeyDown={key}
      onPointerMove={(event) => {
        if (!props.hint) return;
        const box = event.currentTarget.getBoundingClientRect();
        setCursor({ x: event.clientX - box.left, y: event.clientY - box.top });
      }}
      onPointerLeave={() => setCursor(undefined)}
    >
      <ReactFlow
        nodes={nodes}
        edges={lines}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        connectionMode={ConnectionMode.Loose}
        onEdgesChange={(changes: EdgeChange[]) => setLines((now) => applyEdgeChanges(changes, now))}
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
        onSelectionChange={({ nodes: chosen, edges: picks }) =>
          props.onSelect(picked(props.map, chosen, picks))
        }
        onNodeClick={(event, node) => {
          if (props.tool.kind === "line") {
            const hit = node.type === "note" ? node.id.slice("shape:".length) : node.id;
            if (node.type !== "anchor") props.onLine(lineEnd({ x: 0, y: 0 }, hit));
            return;
          }
          if (node.type === "note" || node.type === "anchor") return;
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
          else if (node.type !== "card" && node.type !== "anchor") props.onRename(node.id);
        }}
        onEdgeClick={(_, edge) => {
          if (edge.id.startsWith("line:")) return;
          const relation = (edge.data as { relation: ObjectsMap["relations"][number] }).relation;
          if (relation.count > 1) {
            props.onPopover({ kind: "relations", items: relation.relations, edge: edge.id });
          } else if (relation.link) {
            props.onPopover({ kind: "object", address: relation.link, edge: edge.id });
          }
        }}
        defaultViewport={props.viewport}
        fitView={!props.viewport}
        proOptions={{ hideAttribution: true }}
        onMoveEnd={(_, viewport) => props.onViewport(viewport)}
      >
        <Background gap={16} size={1} color="var(--mw-panel-border, #8883)" />
        {(props.pinned ?? []).map((pin, index) =>
          pin.node !== undefined ? (
            <NodeToolbar
              key={index}
              nodeId={pin.node}
              isVisible
              position={pin.side === "top" ? Position.Top : Position.Right}
              offset={8}
            >
              {pin.content}
            </NodeToolbar>
          ) : pin.edge !== undefined ? (
            <EdgePin key={index} at={middleOf(pin.edge)} side={pin.side}>
              {pin.content}
            </EdgePin>
          ) : null,
        )}
      </ReactFlow>
      {props.hint && cursor && <CursorHint at={cursor} text={props.hint} />}
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
