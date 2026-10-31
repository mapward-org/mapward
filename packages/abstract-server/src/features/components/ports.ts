import type { MapObject } from "@mapward/core";
import type { MapRef } from "../../kernel/map-ref.ts";

/**
 * Что дисплеям нужно от карты: объект по адресу, без детей, — у него метрика, экшон или группа
 * с раскладкой. Отдаёт фича карты.
 */
export type DisplaysMapSource = {
  object(ref: MapRef, address: string): Promise<MapObject | undefined>;
};
