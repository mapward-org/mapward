import type { MapMetric, MapObject, MetricGroup } from "@mapward/core";
import type { CardSize } from "../../../kernel/object-ref.ts";
import { groupMetrics, previewGroup } from "@mapward/core";

/**
 * Что показывает карточка объекта. Превью — это вкладка объекта: у неё карточка берёт метрики
 * и раскладку (поле `layout` группы, а без него — список), отдельного описания у превью нет.
 *
 * - объект ещё не пришёл с сервера — строка «загружается», а не «нет объекта»;
 * - объекта нет — сообщение, а не пустое место;
 * - названной вкладки нет — сообщение, без подмены: иначе карточка показала бы чужие метрики
 *   под видом заказанных;
 * - вкладку не назвали и превью у объекта нет — одна шапка, без метрик и без подписки.
 */
export type CardView =
  | { kind: "loading"; note: string }
  | { kind: "missing-object"; note: string }
  | { kind: "missing-group"; object: MapObject; note: string }
  | { kind: "header"; object: MapObject }
  | {
      kind: "preview";
      object: MapObject;
      group: MetricGroup;
      metrics: MapMetric[];
    };

export function cardView(object: MapObject | undefined, address: string, key?: string): CardView {
  if (!object || object.isGroup) {
    return { kind: "missing-object", note: `нет объекта ${address.replace("mapward://", "")}` };
  }
  const { group, missing } = previewGroup(object, key);
  if (missing !== undefined)
    return { kind: "missing-group", object, note: `нет вкладки ${missing}` };
  if (!group) return { kind: "header", object };
  return {
    kind: "preview",
    object,
    group,
    metrics: groupMetrics(object, group.key),
  };
}

/** Объект ещё не пришёл: ответа сервера нет, и «нет объекта» было бы враньём. */
export const LOADING_CARD: CardView = { kind: "loading", note: "загружается…" };

/** Размер — как в раскладках: css-строка, число — пиксели. */
export const cssSize = (size: CardSize | undefined): string | undefined =>
  typeof size === "number" ? `${size}px` : size;
