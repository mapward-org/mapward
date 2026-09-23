import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod, createBridgeSubscription } from "./bridge.ts";

/**
 * Директива, где этап кончился и ход у человека, — решение 0034. В пункте всё, чтобы показать
 * его и открыть файл, не читая карту заново.
 */
export const Turn = T.Object({
  mapPath: T.String(),
  address: T.String(),
  object: T.String(),
  directive: T.String(),
  path: T.String(),
  stage: T.String(),
  /** Когда кончился этап, ISO-строкой. */
  at: T.String(),
});
export type Turn = Static<typeof Turn>;

/**
 * Список «ждут ответа» держит сервер, в памяти: он общий для всех карт окна, свежие сверху.
 * Клик по пункту — ход взят, пункт убирается.
 */
export const turnsBridge = {
  watchTurns: createBridgeSubscription(T.Void(), T.Array(Turn)),
  dismissTurn: createBridgeMethod(
    T.Object({ mapPath: T.String(), address: T.String(), directive: T.String() }),
    T.Void(),
  ),
};
