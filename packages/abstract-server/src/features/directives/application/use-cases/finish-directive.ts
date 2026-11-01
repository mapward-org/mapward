import type { MapRef } from "../../../../kernel/map-ref.ts";
import { noStage, pickStage } from "../../domain/stages.ts";
import type { DirectiveTurns } from "../../ports.ts";
import type { DirectiveLocator } from "../services/directive-locator.ts";
import type { DirectiveState } from "../services/directive-state.ts";

/** Этап закончен. Помечает ли это директиву выполненной, решает сам этап. */
export class FinishDirective {
  constructor(
    private readonly locator: DirectiveLocator,
    private readonly state: DirectiveState,
    private readonly turns: DirectiveTurns,
  ) {}

  async run(
    params: MapRef & { address: string; directive: string; stage?: string; reply?: string },
  ) {
    const found = await this.locator.directive(params);
    const stage = pickStage(found.stages, params.stage);
    if (!stage) throw noStage(found.stages, params.stage);

    // Реплика и статус — одной записью в файл директивы (решение 0039).
    await this.state.finished({
      directivePath: found.file.path,
      stage: stage.name,
      marksDone: stage.marksDone,
      ...(params.reply === undefined ? {} : { reply: params.reply }),
      now: new Date(),
    });
    // Ход у человека. Кладётся после записи состояния: не записалось — ждать нечего.
    this.turns.finished({
      mapPath: params.mapPath,
      address: found.object.address,
      object: found.object.name,
      directive: found.file.name,
      path: found.file.path,
      stage: stage.name,
      at: new Date().toISOString(),
    });

    return { stage: stage.name, done: stage.marksDone };
  }
}
