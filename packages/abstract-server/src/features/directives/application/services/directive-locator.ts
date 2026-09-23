import { findObject } from "@mapward/core";
import type { MapFile, MapObject, MapStage } from "@mapward/core";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import type { DirectivesMapSource } from "../../ports.ts";

export type Located = { object: MapObject; file: MapFile; stages: MapStage[] };

/**
 * Объект, директива и действующие на нём этапы — всё из модели, а не склейкой путей.
 *
 * Модель догоняет диск вотчером, и файл, который агент только что написал мимо сервера, в ней
 * может ещё не появиться. Поэтому промах — повод перечитать карту и спросить ещё раз, а не
 * сразу ошибка (решение 0041).
 */
export class DirectiveLocator {
  constructor(private readonly map: DirectivesMapSource) {}

  async object(ref: MapRef, address: string): Promise<MapObject> {
    const found = findObject(await this.map.current(ref), address);
    if (found) return found;
    await this.map.reload(ref);
    const again = findObject(await this.map.current(ref), address);
    if (!again) throw new Error(`Объект ${address} не найден`);
    return again;
  }

  async directive(ref: MapRef & { address: string; directive: string }): Promise<Located> {
    const first = await this.object(ref, ref.address);
    const object = first.directives.some((entry) => entry.name === ref.directive)
      ? first
      : await this.reloaded(ref);
    const file = object.directives.find((entry) => entry.name === ref.directive);
    if (!file) {
      const known = object.directives.map((entry) => entry.name).join(", ");
      throw new Error(`У объекта нет директивы ${ref.directive}. Есть: ${known || "ни одной"}.`);
    }
    return { object, file, stages: object.workflow };
  }

  private async reloaded(ref: MapRef & { address: string }): Promise<MapObject> {
    await this.map.reload(ref);
    return this.object(ref, ref.address);
  }
}
