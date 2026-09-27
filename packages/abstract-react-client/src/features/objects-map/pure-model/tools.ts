import type { MapOp, PaletteItem } from "@mapward/core";

/** Что ставит клик по холсту — боковая панель, как в Miro. Фигура — пометка, не объект. */
export type Tool =
  | { kind: "select" }
  | { kind: "shape"; shape: "rect" | "ellipse" | "text" }
  | { kind: "object"; prototype: string }
  | { kind: "relation"; prototype: string };

/** Что открыто поверх холста по клику: превью объекта или список склеенных связей. */
export type Popover =
  | { kind: "object"; address: string }
  | { kind: "relations"; items: { label: string; link: string }[] };

/** Выделенное на холсте, что можно удалить клавишей: у каждого вида своя операция. */
export type Deletable = { kind: "object" | "ref" | "shape"; id: string; label: string };

export const sameTool = (a: Tool, b: Tool): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Пункт боковой панели: заголовок раздела или инструмент с подписью и подсказкой. */
export type ToolItem =
  | { key: string; heading: string }
  | { key: string; tool: Tool; title: string; label: string };

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
  ];
  if (palette.objects.length > 0) items.push({ key: "h-objects", heading: "объекты" });
  for (const item of palette.objects) {
    items.push({
      key: `o:${item.prototype}`,
      tool: { kind: "object", prototype: item.prototype },
      title: `Новый объект прототипа «${item.label}»`,
      label: `▢ ${item.label}`,
    });
  }
  if (palette.relations.length > 0) items.push({ key: "h-relations", heading: "связи" });
  for (const item of palette.relations) {
    items.push({
      key: `r:${item.prototype}`,
      tool: { kind: "relation", prototype: item.prototype },
      title: `Связь «${item.label}»: тяни от нижней точки узла к верхней`,
      label: `→ ${item.label}`,
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
