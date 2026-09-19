/**
 * Проекция ответа: зовущий перечисляет поля, которые ему нужны, и получает ровно их — решение
 * 0016. Пустой список значит «всё»: кто не просил, получает прежний ответ целиком, как
 * `select *`.
 *
 * Пути точечные — `metrics.value`, `children.name`. Массив на пути не считается уровнем:
 * проекция раскладывается на каждый его элемент, потому что спрашивают про поле метрики, а не
 * про поле списка метрик.
 */
type Node = { whole: boolean; fields: Map<string, Node> };

const node = (): Node => ({ whole: false, fields: new Map() });

function plant(paths: string[]): Node {
  const root = node();

  for (const path of paths) {
    let current = root;
    for (const step of path.split(".")) {
      if (!step) break;
      const next = current.fields.get(step) ?? node();
      current.fields.set(step, next);
      current = next;
    }
    // Путь кончился на этом узле — значит просили ветку целиком, и уточнения ниже не нужны.
    if (current !== root) current.whole = true;
  }

  return root;
}

function pick(value: unknown, at: Node): unknown {
  if (at.whole || at.fields.size === 0) return value;
  if (Array.isArray(value)) return value.map((item) => pick(item, at));
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [name, child] of at.fields) {
    if (name in source) result[name] = pick(source[name], child);
  }
  return result;
}

/** `fields` пуст или не задан — значение возвращается как есть. */
export function project<T>(value: T, fields: readonly string[] | undefined): unknown {
  if (!fields || fields.length === 0) return value;
  return pick(value, plant([...fields]));
}
