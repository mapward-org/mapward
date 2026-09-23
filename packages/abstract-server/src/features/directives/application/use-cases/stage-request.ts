import type { MapRef } from "../../../../kernel/map-ref.ts";
import { stageRequest } from "../../domain/prompts.ts";
import { noStage, pickStage } from "../../domain/stages.ts";
import type { DirectiveLocator } from "../services/directive-locator.ts";

/**
 * Фраза для кнопки этапа: хост отправляет её в живую сессию, агент по ней зовёт `runDirective`
 * сам. Составляет её сервер, а не кнопка, — решение 0017.
 */
export class StageRequest {
  constructor(private readonly locator: DirectiveLocator) {}

  async run(params: MapRef & { address: string; directive: string; stage: string }) {
    const found = await this.locator.directive(params);
    const stage = pickStage(found.stages, params.stage);
    if (!stage) throw noStage(found.stages, params.stage);
    return {
      text: stageRequest({ object: found.object, directive: found.file.name, stage: stage.name }),
    };
  }
}
