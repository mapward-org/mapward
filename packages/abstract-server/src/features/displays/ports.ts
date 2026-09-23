import type { MapObject } from "@mapward/core";
import type { MapRef } from "../../kernel/map-ref.ts";

/** Что дисплеям нужно от карты: найти метрику и её компонент. Отдаёт фича карты. */
export type DisplaysMapSource = {
  current(ref: MapRef): Promise<MapObject>;
};
