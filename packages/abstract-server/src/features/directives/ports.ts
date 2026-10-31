import type { MapObject } from "@mapward/core";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Порты директив к соседним фичам — решение 0041: объявляет потребитель, стыкует сборка сервера.
 */

/**
 * От карты: объект по адресу — без детей, директивам они не нужны, — и перечитать, если
 * директивы в модели нет.
 */
export type DirectivesMapSource = {
  object(ref: MapRef, address: string): Promise<MapObject | undefined>;
  reload(ref: MapRef): Promise<void>;
};

/** Какая директива: имя файла у разных объектов совпадает, а адрес объекта — у разных карт. */
export type DirectiveKey = { mapPath: string; address: string; directive: string };

type DirectiveTurn = DirectiveKey & { object: string; path: string; stage: string; at: string };

/** От ленты активности (решение 0034): этап начался — директива идёт, кончился — ход у человека. */
export type DirectiveTurns = {
  started(turn: DirectiveTurn): void;
  finished(turn: DirectiveTurn): void;
};
