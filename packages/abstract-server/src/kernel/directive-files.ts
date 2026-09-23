import { join } from "../lib/path.ts";

/**
 * Где лежит состояние прогонов директивы. Общее у карты и директив: директивы его пишут, а
 * карта по нему говорит статус директивы в модели объекта.
 */
export const directiveStatePath = (objectPath: string, directive: string) =>
  join(objectPath, "_directives.state", `${directive.replace(/\.md$/, "")}.state.json`);
