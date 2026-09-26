import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "./bridge.ts";

/** Где пункт и когда он стал таким — общее у директивы и у прогона. */
const place = {
  mapPath: T.String(),
  address: T.String(),
  object: T.String(),
  /** Когда пункт стал таким, ISO-строкой. */
  at: T.String(),
};

/**
 * Этап директивы в ленте — решение 0034: идёт, пока агент его не кончил, потом ждёт ответа
 * человека. В пункте всё, чтобы показать его и открыть файл, не читая карту заново.
 */
export const DirectiveTurn = T.Object({
  kind: T.Literal("directive"),
  state: T.Union([T.Literal("running"), T.Literal("waiting")]),
  ...place,
  directive: T.String(),
  path: T.String(),
  stage: T.String(),
});
export type DirectiveTurn = Static<typeof DirectiveTurn>;

/** Прогон экшона в ленте: идёт, а упал — висит, пока его не откроют. Успешный уходит сам. */
export const ActionTurn = T.Object({
  kind: T.Literal("action"),
  state: T.Union([T.Literal("running"), T.Literal("failed")]),
  ...place,
  /** Номер прогона — его выбирает экран прогонов объекта. */
  run: T.String(),
  label: T.String(),
});
export type ActionTurn = Static<typeof ActionTurn>;

export const Turn = T.Union([DirectiveTurn, ActionTurn]);
export type Turn = Static<typeof Turn>;

/** Какой пункт открыли: директива — объектом и файлом, прогон — номером в своей карте. */
export const TurnKey = T.Union([
  T.Object({ mapPath: T.String(), address: T.String(), directive: T.String() }),
  T.Object({ mapPath: T.String(), run: T.String() }),
]);
export type TurnKey = Static<typeof TurnKey>;

/**
 * Лента в кружке сайдбара держит сервер, в памяти: она общая для всех карт окна, свежие сверху.
 * Клик по пункту — ход взят: ждущее и упавшее убираются, идущее уйдёт само, когда кончится.
 */
export const turnsBridge = {
  watchTurns: createBridgeSubscription(T.Void(), T.Array(Turn)),
  dismissTurn: createBridgeMethod(TurnKey, T.Void()),
};
