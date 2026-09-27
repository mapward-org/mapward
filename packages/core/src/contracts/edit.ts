import * as T from "typebox";
import type { Static } from "typebox";
import { createBridgeMethod } from "./bridge.ts";
import { MapOp } from "../model/map-edit.ts";

/**
 * Правка карты — решение 0044. Холст зовёт те же операции, что агент через MCP: пачка операций
 * применяется по очереди и отменяется целиком. Стек отмены держит тот, кто звал, — сервер
 * помнит пачки по номеру, но не решает, чья отмена следующая.
 */

const EditTarget = { mapPath: T.String(), basePath: T.String(), name: T.String() };

export const EditResult = T.Union([
  T.Object({
    ok: T.Literal(true),
    /** Номер пачки: по нему её отменяют. */
    id: T.String(),
    /** Какие файлы пачка тронула — для отчёта агенту и человеку. */
    touched: T.Array(T.String()),
  }),
  T.Object({
    ok: T.Literal(false),
    /** Почему отказ: имя занято, перенос внутрь себя, файлы поменяли мимо отмены. */
    error: T.String(),
  }),
]);
export type EditResult = Static<typeof EditResult>;

export const editBridge = {
  editMap: createBridgeMethod(T.Object({ ...EditTarget, ops: T.Array(MapOp) }), EditResult),
  undoEdit: createBridgeMethod(T.Object({ ...EditTarget, id: T.String() }), EditResult),
  /** Повтор отменённой пачки — Ctrl+Shift+Z: отмена отмены, с той же проверкой файлов. */
  redoEdit: createBridgeMethod(T.Object({ ...EditTarget, id: T.String() }), EditResult),
};
