import type { ArrowStyle, ViewShape } from "@mapward/core";

/**
 * Последние настройки, как в Miro: что поставили фигуре, линии или связи, то и получит
 * следующая такая же — цвет и форму не настраивают заново. Помнится по виду: у прямоугольника,
 * эллипса, текста, линии и связи своё. Это настройка смотрящего, а не вьюхи: лежит в состоянии
 * редактора и переживает перезагрузку окна.
 */
export type StyleKind = "rect" | "ellipse" | "text" | "line" | "arrow";
export type Remembered = Partial<Record<StyleKind, Record<string, unknown>>>;

/** Что помнится: стиль, но не место, размер, текст и концы. */
const FIELDS: Record<StyleKind, string[]> = {
  rect: ["color", "stroke", "textColor", "fontSize", "strokeWidth", "align"],
  ellipse: ["color", "stroke", "textColor", "fontSize", "strokeWidth", "align"],
  text: ["color", "stroke", "textColor", "fontSize", "align"],
  line: ["stroke", "strokeWidth", "textColor", "fontSize", "route", "arrow"],
  arrow: ["stroke", "strokeWidth", "textColor", "fontSize", "route"],
};

/** Поправили стиль — он запоминается поверх прежнего; «без цвета» снимает запомненное поле. */
export function rememberStyle(
  memory: Remembered,
  kind: StyleKind,
  patch: Record<string, unknown>,
): Remembered {
  const next: Record<string, unknown> = { ...memory[kind] };
  for (const [key, value] of Object.entries(patch)) {
    if (!FIELDS[kind].includes(key)) continue;
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return { ...memory, [kind]: next };
}

/** Новая фигура или линия — сразу в запомненном стиле своего вида. */
export function withRemembered(shape: ViewShape, memory: Remembered): ViewShape {
  return { ...shape, ...memory[shape.kind] } as ViewShape;
}

/** Стиль новой связи; ничего не запомнено — `undefined`, и стиль не пишется вовсе. */
export function rememberedArrow(memory: Remembered): ArrowStyle | undefined {
  const style = memory.arrow;
  return style && Object.keys(style).length > 0 ? (style as ArrowStyle) : undefined;
}
