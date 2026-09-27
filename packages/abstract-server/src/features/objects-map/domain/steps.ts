import type { FileChange } from "@mapward/core";
import { join, relative } from "../../../lib/path.ts";

/**
 * Шаг применения правки — то, что сервер делает с диском (решение 0044). Удаления среди шагов
 * нет: удалённая папка уезжает в корзину правки, чтобы отмена могла её вернуть. `delete` —
 * только файл, которого до правки не было: его отмена записи.
 */
export type Step =
  | { kind: "write"; path: string; text: string }
  | { kind: "delete"; path: string }
  | { kind: "move"; from: string; to: string };

/** Корзина пачки — скрытая папка карты: локальное, в git не попадает (решение 0038). */
export const trashOf = (mapPath: string, id: string) => join(mapPath, ".mapward", "trash", id);

/** Правки операции шагами: удаление папки — перенос в корзину пачки по тому же пути от корня. */
export function toSteps(changes: FileChange[], mapPath: string, id: string): Step[] {
  return changes.map((change): Step => {
    if (change.kind !== "remove") return change;
    return {
      kind: "move",
      from: change.path,
      to: join(trashOf(mapPath, id), relative(mapPath, change.path)),
    };
  });
}

/** Лежит ли путь в папке (или это она сама). */
export const inside = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

/** Путь после переноса папки: то, что лежало в ней, лежит теперь в новой. */
export const shifted = (path: string, from: string, to: string) =>
  inside(path, from) ? to + path.slice(from.length) : path;
