import type { MapObject, MapStage } from "@mapward/core";

/**
 * Открытый файл узнаёт в себе директиву, если он есть в списке директив какого-то объекта
 * карты, — решение 0032. Путь склейкой не угадываем: унаследованная директива лежит у
 * прототипа, а не рядом с объектом, и знает об этом только модель.
 *
 * Пути сравниваются без оглядки на косую и регистр диска: модель пишет `d:/…`, а редактор
 * отдаёт `d:\…`.
 */
export type LocatedDirective = { object: MapObject; directive: string; stages: MapStage[] };

const normalize = (path: string) =>
  path.replaceAll("\\", "/").replace(/^([a-z]):/i, (drive) => drive.toLowerCase());

export function locateDirective(root: MapObject, filePath: string): LocatedDirective | undefined {
  const wanted = normalize(filePath);
  const file = root.directives.find((entry) => normalize(entry.path) === wanted);
  // Директива, доставшаяся от прототипа, в его же списке лежит своей: берём объект, у которого
  // файл свой, — там и правят, и там же его этапы.
  if (file && !file.owner) {
    const stages = root.workflow.toSorted((a, b) => a.order - b.order);
    return { object: root, directive: file.name, stages };
  }
  for (const child of root.children) {
    const found = locateDirective(child, filePath);
    if (found) return found;
  }
  return undefined;
}
