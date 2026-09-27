import type { MapObject } from "@mapward/core";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Порты вьюхи к соседним фичам — решение 0041: объявляет потребитель, стыкует сборка сервера.
 */

/**
 * От основной карты: живая модель и перечитать то, что правка тронула. Правка пишет мимо
 * вотчера и следом считает следующую операцию пачки по модели — ей нужна модель со своим.
 */
export type ObjectsMapSource = {
  current(ref: MapRef): Promise<MapObject>;
  refresh(paths: string[]): Promise<void>;
};
