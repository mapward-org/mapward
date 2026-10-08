import type { ArrowStyle, PaletteItem, ViewNode, ViewRelation, ViewShape } from "@mapward/core";

/**
 * Контекстная панель у выделенного — одна на все виды, как в Miro (решение 0044). Какие кнопки
 * в ней стоят, зависит только от вида выделенного: показывается применимое, остальное — нет.
 */

export type Target =
  | { kind: "shape"; shape: ViewShape }
  | { kind: "arrow"; arrow: ViewRelation }
  | { kind: "object"; node: ViewNode };

/** Кнопка панели; `|` — разделитель между группами. */
export type BarKey =
  | "fill"
  | "stroke"
  | "text"
  | "width"
  | "route"
  | "arrows"
  | "align"
  | "edit"
  | "dive"
  | "delete"
  | "|";

/** Кнопки с выпадашкой: у остальных клик — сразу действие. Текст — цвет и размер вместе. */
export type Menu = "fill" | "stroke" | "text" | "width" | "route" | "arrows" | "align";

/** Поле стиля, которое правит выпадашка. */
export type Field =
  | "fill"
  | "stroke"
  | "textColor"
  | "fontSize"
  | "width"
  | "route"
  | "arrows"
  | "align";

export function barFor(target: Target): BarKey[] {
  switch (target.kind) {
    case "object":
      return ["edit", "dive", "|", "delete"];
    case "arrow":
      // Склеенная стрелка — не одна связь: удалить её одной кнопкой нельзя.
      return target.arrow.count > 1
        ? ["stroke", "width", "|", "text", "|", "route"]
        : ["stroke", "width", "|", "text", "|", "route", "|", "dive", "delete"];
    case "shape":
      switch (target.shape.kind) {
        case "line":
          return ["stroke", "width", "|", "route", "arrows", "|", "text", "|", "delete"];
        case "text":
          return ["text", "align", "fill", "|", "delete"];
        default:
          return ["fill", "stroke", "width", "|", "text", "align", "|", "delete"];
      }
  }
}

/** Текущие значения стиля выделенного — ими помечены кнопки и выбранное в выпадашках. */
export type Look = {
  fill?: string | undefined;
  stroke?: string | undefined;
  textColor?: string | undefined;
  fontSize?: number | undefined;
  width?: number | undefined;
  route?: string | undefined;
  arrows?: string | undefined;
  align?: string | undefined;
};

export function lookOf(target: Target | undefined): Look {
  if (!target) return {};
  if (target.kind === "shape") {
    const { shape } = target;
    return {
      fill: shape.color,
      stroke: shape.stroke,
      textColor: shape.textColor,
      fontSize: shape.fontSize,
      width: shape.strokeWidth,
      route: shape.route,
      arrows: shape.arrow,
      align: shape.align,
    };
  }
  if (target.kind === "arrow") {
    const style: ArrowStyle = target.arrow.style ?? {};
    return {
      stroke: style.stroke,
      textColor: style.textColor,
      fontSize: style.fontSize,
      width: style.strokeWidth,
      route: style.route,
    };
  }
  return {};
}

/** Правка стиля по выпадашке: для фигуры и для стрелки поля называются по-разному. */
export function patchFor(
  target: Target,
  menu: Field,
  value: string | number | undefined,
): Partial<ViewShape> | Partial<ArrowStyle> {
  const field =
    target.kind === "shape"
      ? {
          fill: "color",
          stroke: "stroke",
          textColor: "textColor",
          fontSize: "fontSize",
          width: "strokeWidth",
          route: "route",
          arrows: "arrow",
          align: "align",
        }[menu]
      : {
          fill: "stroke",
          stroke: "stroke",
          textColor: "textColor",
          fontSize: "fontSize",
          width: "strokeWidth",
          route: "route",
          arrows: "route",
          align: "route",
        }[menu];
  return { [field]: value };
}

/** Недавние цвета: свежий первым, без повторов, не больше шести. */
export function remember(recent: string[], color: string | undefined): string[] {
  if (!color) return recent;
  return [color, ...recent.filter((one) => one !== color)].slice(0, 6);
}

/** Сколько чипов прототипов видно на рейке сразу; остальные — в выпадашке «+». */
export const RAIL_CHIPS = 6;

export function railObjects(palette: PaletteItem[]): { shown: PaletteItem[]; more: PaletteItem[] } {
  return { shown: palette.slice(0, RAIL_CHIPS), more: palette.slice(RAIL_CHIPS) };
}

/** Значение числового поля со степпером: в пределах и с шагом. */
export function stepped(
  value: number | undefined,
  step: number,
  min: number,
  max: number,
  fallback: number,
): number {
  const next = (value ?? fallback) + step;
  return Math.min(max, Math.max(min, Number(next.toFixed(2))));
}

/** Режимы пути иконками — у связи и у линии. */
export const ROUTES = [
  { key: "straight", icon: "╱", title: "Ломаная — отрезки через изломы" },
  { key: "rounded", icon: "◠", title: "Скруглённая — скругления на изломах" },
  { key: "orthogonal", icon: "┘", title: "Прямые углы — только горизонталь и вертикаль" },
] as const;

/** Стрелки линии иконками. */
export const ARROWS = [
  { key: "none", icon: "—", title: "Без стрелок" },
  { key: "end", icon: "→", title: "Стрелка на конце" },
  { key: "both", icon: "↔", title: "Стрелки с обеих сторон" },
] as const;

/** Выравнивание текста пометки иконками — только по горизонтали. */
export const ALIGNS = [
  { key: "left", icon: "⇤", title: "Текст влево" },
  { key: "center", icon: "↔", title: "Текст по центру" },
  { key: "right", icon: "⇥", title: "Текст вправо" },
] as const;

export const alignIcon = (align: string | undefined): string =>
  ALIGNS.find((one) => one.key === (align ?? "center"))?.icon ?? "↔";

export const routeIcon = (route: string | undefined): string =>
  ROUTES.find((one) => one.key === (route ?? "straight"))?.icon ?? "╱";

export const FONT_SIZES = [10, 12, 14, 18, 24, 32];
export const WIDTHS = [1, 1.5, 2, 3, 5];

/** Шаг степпера по полю: размер текста — по 1, толщина — по 0,5, в своих пределах. */
export function stepField(
  field: "fontSize" | "width",
  value: number | undefined,
  delta: number,
): number {
  return field === "fontSize"
    ? stepped(value, delta, 6, 96, 11)
    : stepped(value, delta * 0.5, 0.5, 20, 1.5);
}
