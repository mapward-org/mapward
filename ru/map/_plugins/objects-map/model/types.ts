import { literal, number, object, string, union } from "./schema.ts";

/**
 * Форма вьюхи карты — то, что холст рисует, а процесс плагина считает (`view.ts`): узлы, стрелки,
 * пометки, палитра. Компоненты холста берут отсюда только типы; схемы — для операций холста,
 * которые видит агент (`ops.ts`).
 */

export type NodeShape = "rect" | "round" | "ellipse" | "diamond" | "note";
export type NodeView = "simple" | "preview";
/** Линия стрелки: у связей разных прототипов она своя, чтобы их различать на глаз. */
export type LinePattern = "solid" | "dashed" | "dotted";

export type Point = { x: number; y: number };

/** Сторона рамки узла, из которой выходит конец стрелки. */
export type Side = "top" | "right" | "bottom" | "left";
export const Side = union(literal("top"), literal("right"), literal("bottom"), literal("left"));

/** Выравнивание текста по горизонтали — у подписи узла и у текста пометки. */
export type TextAlign = "left" | "center" | "right";
export const TextAlign = union(literal("left"), literal("center"), literal("right"));

/** Как стрелка идёт через изломы: ломаной, скруглённо или прямыми углами. */
export type Route = "straight" | "rounded" | "orthogonal";
export const Route = union(literal("straight"), literal("rounded"), literal("orthogonal"));

export const PointSchema = object({ x: number, y: number });

/** Стиль стрелки-связи на этой вьюхе: толщина, цвет, подпись и путь. */
export type ArrowStyle = {
  stroke?: string;
  strokeWidth?: number;
  textColor?: string;
  fontSize?: number;
  route?: Route;
  /**
   * Где конец цепляется за объект: точка в долях его рамки, `{ x: 1, y: 0.5 }` — середина
   * правого края. Не задана — конец плавающий и выходит из ближайшей к другому концу точки.
   */
  fromAnchor?: Point;
  toAnchor?: Point;
};
export const ArrowStyle = object(
  {},
  {
    stroke: string,
    strokeWidth: number,
    textColor: string,
    fontSize: number,
    route: Route,
    fromAnchor: PointSchema,
    toAnchor: PointSchema,
  },
);

/**
 * Конец линии — точка на холсте или узел и фигура, к которым линия прицеплена и за которыми
 * едет. Прицепленный конец, чей узел исчез с холста, линия не рисует.
 */
export type LineEnd = Point | { node: string };
export const LineEnd = union(PointSchema, object({ node: string }));

/**
 * Фигура — пометка на холсте, не объект карты: ни папки, ни метрик. Линия — тоже пометка, а не
 * связь: связь ставится стрелкой из палитры и заводит объект.
 */
export type ViewShape = {
  id: string;
  kind: "rect" | "ellipse" | "text" | "line";
  /**
   * Группа, на которой пометка нарисована: пометка ездит, копируется и удаляется вместе с ней, а
   * `x` и `y` отсчитаны от группы, как позиции её жильцов. Нет — пометка лежит на холсте.
   */
  parent?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  /** Заливка. Старое имя поля — файлы вьюх, написанные до стиля, читаются как раньше. */
  color?: string;
  stroke?: string;
  textColor?: string;
  fontSize?: number;
  align?: TextAlign;
  /** Только у линии: её концы и стрелки на них. */
  from?: LineEnd;
  to?: LineEnd;
  arrow?: "none" | "end" | "both";
  /** Толщина обводки или линии, в пикселях. */
  strokeWidth?: number;
  /** Только у линии: как идёт путь через изломы. */
  route?: Route;
};
export const ViewShape = object(
  {
    id: string,
    kind: union(literal("rect"), literal("ellipse"), literal("text"), literal("line")),
    x: number,
    y: number,
  },
  {
    parent: string,
    width: number,
    height: number,
    text: string,
    color: string,
    stroke: string,
    textColor: string,
    fontSize: number,
    align: TextAlign,
    from: LineEnd,
    to: LineEnd,
    arrow: union(literal("none"), literal("end"), literal("both")),
    strokeWidth: number,
    route: Route,
  },
);

/**
 * Размер узла на холсте. `scale` — масштаб содержимого: растяжение даёт карточке больше места,
 * а масштаб увеличивает или уменьшает её целиком, вместе с текстом и метриками.
 */
export type Size = { width: number; height: number; scale?: number };

export type ViewNode = {
  id: string;
  /** `copy` — копия-отображение: `id` свой, `object` и `link` — объекта, на который она указывает. */
  kind: "object" | "ref" | "copy";
  label: string;
  link: string;
  /** Адрес объекта — у узла с полным превью по нему рисуется карточка. */
  object: string;
  prototype?: string;
  /** Группа, внутри которой узел нарисован; нет — лежит на холсте. */
  parent?: string;
  shape: NodeShape;
  color?: string;
  textColor?: string;
  view: NodeView;
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
  align?: TextAlign;
  /**
   * Группа — рамка с жильцами, как фрейм в Miro. Группой объект делает только конфиг вьюхи
   * (`expand`): на холсте её не сворачивают, иначе размеры и позиции соседей поехали бы.
   */
  expanded: boolean;
  position?: Point;
  /** Размер, растянутый руками; нет — размер из стиля. */
  size?: Size;
};

/**
 * Стрелка на холсте. Концы — узлы, которые видны: стрелка к жильцу свёрнутой группы поднята к
 * группе, как в C4. Несколько связей на одну пару узлов склеены в одну, и `relations`
 * говорит, из каких она собрана.
 */
export type ViewRelation = {
  id: string;
  from: string;
  to: string;
  label?: string;
  link?: string;
  count: number;
  relations: { label: string; link: string }[];
  /** Точки излома, если стрелку ломали руками; нет — прямой путь. */
  bends?: Point[];
  style?: ArrowStyle;
  /** Цвет и линия прототипа связи — по ним стрелки разных прототипов различимы. */
  color?: string;
  line?: LinePattern;
};

/** Кнопка боковой панели: прототип и его цвета — чтобы кнопку было видно по цвету стикера. */
export type PaletteItem = {
  prototype: string;
  label: string;
  color?: string;
  textColor?: string;
  /** Только у прототипа связи: линия, которой его стрелка рисуется. */
  line?: LinePattern;
  /** Объекты прототипа — фреймы (`expand`): их рисуют протяжкой, а не ставят кликом. */
  frame?: boolean;
};

/** Вьюха целиком — значение метода `view` плагина `objects-map`, данные его холста. */
export type ObjectsMap = {
  /** Адрес метрики: операции холста правят именно эту вьюху. */
  view: string;
  nodes: ViewNode[];
  relations: ViewRelation[];
  shapes: ViewShape[];
  palette: { objects: PaletteItem[]; relations: PaletteItem[] };
  /** Можно ли создавать объект на пустом месте и проводить стрелки. */
  canPlaceObjects: boolean;
  canPlaceRelations: boolean;
};
