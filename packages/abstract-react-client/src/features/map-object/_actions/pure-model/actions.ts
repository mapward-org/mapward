import { complete, findActionOwner } from "@mapward/core";
import type { ActionInput, MapAction, MapMetric, MapObject } from "@mapward/core";

/** Значение поля формы, как его держит вид: флажок — да или нет, остальное — текст поля. */
export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

export const actionLabel = (action: MapAction) => action.config.label ?? action.key;

/**
 * Какой экшон назван — решение 0038: ключ экшона объекта, на котором висит метрика, или полный
 * адрес `mapward://…/_actions/<ключ>`. Не нашёлся — `undefined`, и это ошибка строки, а не
 * метрики: у соседних строк экшон может быть в порядке.
 */
export function resolveAction(
  map: MapObject,
  object: MapObject,
  run: string,
): MapAction | undefined {
  if (run.startsWith("mapward://")) return findActionOwner(map, run)?.action;
  return object.actions.find((action) => action.key === run);
}

/**
 * Нужна ли форма — решение 0038: всё обязательное заполнено умолчаниями или переданным, и
 * `confirm` не просили, — запуск сразу. Спрашивается та же проверка, что сделает сервер.
 */
export const needsForm = (action: MapAction, given: Record<string, unknown>) =>
  action.config.confirm === true || !complete(action.config.inputs, given);

const kind = (input: ActionInput) => input.type ?? "string";

/** С чего форма начинается: переданное строкой дисплея, иначе умолчание, иначе пусто. */
export function startValues(
  inputs: Record<string, ActionInput> | undefined,
  given: Record<string, unknown>,
): FormValues {
  return Object.fromEntries(
    Object.entries(inputs ?? {}).map(([name, input]) => {
      const raw = given[name] ?? input.default;
      if (kind(input) === "boolean") return [name, raw === true || raw === "true"];
      return [name, raw === undefined || raw === null ? "" : String(raw)];
    }),
  );
}

/**
 * Что уходит серверу. Пустое поле не отправляется: пусто — значит «не задано», и умолчание или
 * «обязательное поле» решает сервер. Переданное строкой, но формой не описанное, уходит как есть:
 * опечатку в имени поля должен назвать сервер, а не проглотить вид.
 */
export function formPayload(
  inputs: Record<string, ActionInput> | undefined,
  values: FormValues,
  given: Record<string, unknown>,
): Record<string, unknown> {
  const declared = inputs ?? {};
  const extra = Object.fromEntries(Object.entries(given).filter(([name]) => !(name in declared)));
  const filled = Object.fromEntries(
    Object.entries(values).filter(([name, value]) => name in declared && value !== ""),
  );
  return { ...extra, ...filled };
}

/** Ошибки сервера по полям, которых в форме нет: их показать негде, кроме как над ней. */
export const strayErrors = (
  inputs: Record<string, ActionInput> | undefined,
  errors: Record<string, string>,
): string[] =>
  Object.entries(errors)
    .filter(([name]) => !(name in (inputs ?? {})))
    .map(([name, text]) => `${name}: ${text}`);

const words = (text: string) => text.toLowerCase().replace(/[-_\s]+/g, " ");

/**
 * Поиск по экшонам шапки: от прототипа их бывает много (решение 0038). Каждое слово запроса
 * ищется в подписи, ключе и описании, без регистра; пустой запрос ничего не отбирает.
 */
export function matchActions(actions: MapAction[], query: string): MapAction[] {
  const needles = words(query).split(" ").filter(Boolean);
  if (needles.length === 0) return actions;
  return actions.filter((action) => {
    const hay = words(`${actionLabel(action)} ${action.key} ${action.config.description ?? ""}`);
    return needles.every((needle) => hay.includes(needle));
  });
}

/**
 * Ключи, занятые и метрикой, и экшоном одного объекта. Раскладка находит клетку по ключу, и
 * такой ключ назвал бы две вещи сразу — это ошибка объекта, а не выбор, который делает вид.
 */
export function keyClashes(metrics: MapMetric[], actions: MapAction[]): string[] {
  const metricKeys = new Set(metrics.map((metric) => metric.key));
  return actions.map((action) => action.key).filter((key) => metricKeys.has(key));
}
