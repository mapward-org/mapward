import type { MapOp, PaletteItem } from "@mapward/core";

/**
 * Что ставит холст — боковая панель, как в Miro. Фигура — пометка, не объект. Фигуру, линию и
 * фрейм рисуют протяжкой, карточку ставят кликом.
 */
export type Tool =
  | { kind: "select" }
  | { kind: "shape"; shape: "rect" | "ellipse" | "text" }
  /** Линия: тянешь от начала к концу; над узлом конец к нему прицепляется. */
  | { kind: "line" }
  /** `frame` — прототип рисует фреймы: такой объект тянут рамкой, а не ставят кликом. */
  | { kind: "object"; prototype: string; frame?: true }
  | { kind: "relation"; prototype: string };

/** Инструмент кнопки палитры: у прототипа-фрейма — с пометкой, что его рисуют протяжкой. */
export const objectTool = (item: Pick<PaletteItem, "prototype" | "frame">): Tool => ({
  kind: "object",
  prototype: item.prototype,
  ...(item.frame ? { frame: true as const } : {}),
});

/** Рисуется ли инструментом протяжкой: фигура, линия, фрейм. */
export const draws = (tool: Tool): boolean =>
  tool.kind === "shape" || tool.kind === "line" || (tool.kind === "object" && tool.frame === true);

/** Что открыто поверх холста по клику: превью объекта или список склеенных связей. */
export type Popover =
  /** `edge` — стрелка, у которой поповер встаёт, когда объекта нет на холсте узлом. */
  | { kind: "object"; address: string; edge?: string }
  | { kind: "relations"; items: { label: string; link: string }[]; edge?: string };

/** Выделенное на холсте, что можно удалить клавишей: у каждого вида своя операция. */
export type Deletable = { kind: "object" | "ref" | "shape"; id: string; label: string };

export const sameTool = (a: Tool, b: Tool): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Пункт боковой панели: заголовок раздела или инструмент с подписью и подсказкой. */
export type ToolItem =
  | { key: string; heading: string }
  | {
      key: string;
      tool: Tool;
      title: string;
      label: string;
      /** Цвет прототипа из палитры: кнопка помечена им, подпись — читаемым на нём. */
      color?: string | undefined;
      textColor?: string | undefined;
    };

/** Боковая панель целиком: выбор, фигуры, прототипы объектов и связей из палитры вьюхи. */
export function toolItems(palette: {
  objects: PaletteItem[];
  relations: PaletteItem[];
}): ToolItem[] {
  const items: ToolItem[] = [
    { key: "select", tool: { kind: "select" }, title: "Выбрать и двигать", label: "↖ выбор" },
    { key: "h-shapes", heading: "фигуры" },
    {
      key: "rect",
      tool: { kind: "shape", shape: "rect" },
      title: "Прямоугольник — пометка, не объект",
      label: "▭ прямоугольник",
    },
    {
      key: "ellipse",
      tool: { kind: "shape", shape: "ellipse" },
      title: "Круг — пометка, не объект",
      label: "◯ круг",
    },
    {
      key: "text",
      tool: { kind: "shape", shape: "text" },
      title: "Текст — пометка, не объект",
      label: "T текст",
    },
    {
      key: "line",
      tool: { kind: "line" },
      title: "Линия — пометка, не связь: тяни от начала к концу; над узлом конец цепляется",
      label: "╱ линия",
    },
  ];
  if (palette.objects.length > 0) items.push({ key: "h-objects", heading: "объекты" });
  for (const item of palette.objects) {
    items.push({
      key: `o:${item.prototype}`,
      tool: objectTool(item),
      title: `Новый объект прототипа «${item.label}»`,
      label: `▢ ${item.label}`,
      color: item.color,
      textColor: item.textColor,
    });
  }
  if (palette.relations.length > 0) items.push({ key: "h-relations", heading: "связи" });
  for (const item of palette.relations) {
    items.push({
      key: `r:${item.prototype}`,
      tool: { kind: "relation", prototype: item.prototype },
      title: `Связь «${item.label}»: тяни от любой стороны узла к другому узлу`,
      label: `→ ${item.label}`,
      color: item.color,
      textColor: item.textColor,
    });
  }
  return items;
}

/** Что спросить перед удалением: объект уносит папку и связи, ссылка — только себя. */
export function confirmText(target: Deletable): string {
  switch (target.kind) {
    case "object":
      return `Удалить «${target.label}» вместе с папкой и связями?`;
    case "ref":
      return `Убрать ссылку на «${target.label}» с вьюхи? Сам объект останется`;
    case "shape":
      return `Удалить фигуру «${target.label}»?`;
  }
}

export function deleteOp(view: string, target: Deletable): MapOp {
  switch (target.kind) {
    case "object":
      return { op: "delete-object", object: target.id };
    case "ref":
      return { op: "remove-ref", view, object: target.id };
    case "shape":
      return { op: "remove-shape", view, id: target.id };
  }
}
