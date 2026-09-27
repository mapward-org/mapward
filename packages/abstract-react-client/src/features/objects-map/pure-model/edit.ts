import type { LineEnd, MapOp, ObjectsMap, Point, ViewShape } from "@mapward/core";

/**
 * Правка объекта в диалоге — имя и адрес (решение 0044). Адрес — последний шаг, имя папки; его
 * смена переименовывает папку. Обе правки уходят одной пачкой: одна отмена.
 */
export type Editing = { address: string; name: string; folder: string };

export const folderOf = (address: string): string => address.split("/").at(-1) ?? "";

export function startEditing(map: ObjectsMap, address: string): Editing {
  const node = map.nodes.find((item) => item.id === address);
  return { address, name: node?.label ?? folderOf(address), folder: folderOf(address) };
}

/** Что поменялось — то и уходит; ничего — пустая пачка, и сервер не зовётся. */
export function editOps(view: string, editing: Editing, name: string, folder: string): MapOp[] {
  const ops: MapOp[] = [];
  const label = name.trim();
  const next = folder.trim();
  if (label && label !== editing.name) {
    ops.push({ op: "rename", object: editing.address, label, view });
  }
  if (next && next !== editing.folder) {
    ops.push({ op: "set-folder", object: editing.address, folder: next, view });
  }
  return ops;
}

/**
 * Брошенная карточка до имени: её видно сразу, а на диске её нет, пока не нажат Enter. Esc —
 * и не было ничего.
 */
export type Draft = { prototype: string; parent?: string; position: Point };

export const DRAFT_ID = "draft:new";

/** Черновик на холсте — узел с полем подписи, ещё без адреса. */
export function withDraft(map: ObjectsMap, draft: Draft | undefined): ObjectsMap {
  if (!draft) return map;
  // Черновик сразу цветом своего прототипа из палитры — таким он и появится.
  const item = map.palette.objects.find((one) => one.prototype === draft.prototype);
  const inGroup =
    draft.parent !== undefined && map.nodes.some((n) => n.id === draft.parent && n.expanded);
  return {
    ...map,
    nodes: [
      ...map.nodes,
      {
        id: DRAFT_ID,
        kind: "object",
        label: "",
        link: DRAFT_ID,
        object: DRAFT_ID,
        ...(inGroup && draft.parent !== undefined ? { parent: draft.parent } : {}),
        shape: "rect",
        ...(item?.color === undefined ? {} : { color: item.color }),
        ...(item?.textColor === undefined ? {} : { textColor: item.textColor }),
        view: "simple",
        expandable: false,
        expanded: false,
        position: draft.position,
      },
    ],
  };
}

export function createOp(view: string, draft: Draft, name: string): MapOp | undefined {
  const label = name.trim();
  if (!label) return undefined;
  return {
    op: "create-object",
    view,
    name: label,
    prototype: draft.prototype,
    ...(draft.parent === undefined ? {} : { parent: draft.parent }),
    position: draft.position,
  };
}

/**
 * Конец линии: над узлом или фигурой — прицеплен к нему и едет следом, иначе — точка на холсте.
 * Сама линия целью своего конца не бывает.
 */
export function lineEnd(point: Point, hit: string | undefined, line?: string): LineEnd {
  return hit !== undefined && hit !== line ? { node: hit } : { x: point.x, y: point.y };
}

/** Новая линия от одного конца к другому: стрелка на конце, стиль по умолчанию. */
export function lineShape(id: string, from: LineEnd, to: LineEnd): ViewShape {
  return { id, kind: "line", x: 0, y: 0, from, to, arrow: "end" };
}

/** Стиль поверх полей фигуры или связи: пустое значение поле снимает. */
export function styled<T extends object>(target: T, patch: Partial<T>): T {
  const next: Record<string, unknown> = { ...target, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  return next as T;
}
