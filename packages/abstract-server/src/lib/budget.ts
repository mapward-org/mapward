/**
 * Ответ, не влезший в контекст агента, пропадает целиком — вместе с дешёвыми полями, ради
 * которых звали. Поэтому сервер сам режет самое тяжёлое и говорит, что отрезал: усечь одну
 * метрику дешевле, чем потерять ответ.
 *
 * Режется только `value` метрик — там сидит почти весь вес, а всё остальное в ответе агент
 * выбирает сам проекцией. Какая метрика жирная, заранее знает только сервер: у одной карты
 * дерево требований на десять килобайт, у другой пусто.
 */
type Metric = Record<string, unknown>;
type Node = { metrics?: Metric[]; children?: unknown };

/** Что метрика несёт тяжёлого: собранное значение и конфиг после подстановок. */
const HEAVY = ["value", "config"] as const;

const weigh = (value: unknown): number => (value === undefined ? 0 : JSON.stringify(value).length);

type Slot = { metric: Metric; field: string; bytes: number };

/** Метрики всего поддерева: резать надо и у детей, они приходят тем же ответом. */
function collect(node: unknown, found: Slot[] = []): Slot[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, found);
    return found;
  }
  if (node === null || typeof node !== "object") return found;

  const { metrics, children } = node as Node;
  if (Array.isArray(metrics)) {
    for (const metric of metrics) {
      if (metric === null || typeof metric !== "object") continue;
      for (const field of HEAVY) {
        if (field in metric) found.push({ metric, field, bytes: weigh(metric[field]) });
      }
    }
  }
  if (children !== undefined) collect(children, found);
  return found;
}

/**
 * Возвращает то же значение, с маркером вместо тяжёлых полей метрик. `budget` в байтах json;
 * ноль или меньше означает «не резать».
 *
 * Это ориентир, а не гарантия: перечень метрик и поля объектов остаются, и на запросе по всей
 * карте ответ будет большим даже после резки. Лечится это отбором метрик, а не здесь —
 * выбрасывать то, что агент явно просил, сервер не должен.
 */
export function fit<T>(answer: T, budget: number): T {
  if (budget <= 0) return answer;

  let total = JSON.stringify(answer).length;
  if (total <= budget) return answer;

  // От самой жирной к самой мелкой: каждая следующая режет всё меньше, и резать их все незачем.
  const heavy = collect(answer)
    .filter((slot) => slot.bytes > 0)
    .toSorted((a, b) => b.bytes - a.bytes);

  for (const { metric, field, bytes } of heavy) {
    if (total <= budget) break;
    // Маркер говорит, что здесь было и сколько весило: агент дозовёт эту метрику отдельно.
    metric[field] = { truncated: true, bytes };
    total -= bytes - weigh(metric[field]);
  }

  return answer;
}
