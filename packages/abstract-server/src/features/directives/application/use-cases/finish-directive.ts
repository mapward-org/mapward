import type { MapRef } from "../../../../kernel/map-ref.ts";
import { noStage, pickStage } from "../../domain/stages.ts";
import type { DirectiveTurns } from "../../ports.ts";
import type { DirectiveLocator } from "../services/directive-locator.ts";
import type { DirectiveState } from "../services/directive-state.ts";
import type { DirectiveThread } from "../services/directive-thread.ts";

/** Этап закончен. Помечает ли это директиву выполненной, решает сам этап. */
export class FinishDirective {
  constructor(
    private readonly locator: DirectiveLocator,
    private readonly thread: DirectiveThread,
    private readonly state: DirectiveState,
    private readonly turns: DirectiveTurns,
  ) {}

  async run(
    params: MapRef & { address: string; directive: string; stage?: string; reply?: string },
  ) {
    const found = await this.locator.directive(params);
    const stage = pickStage(found.stages, params.stage);
    if (!stage) throw noStage(found.stages, params.stage);

    // Реплика — до состояния: этап, который помечает директиву выполненной, снимает копию уже
    // с ней (решение 0039).
    if (params.reply !== undefined) {
      await this.thread.append({ directivePath: found.file.path, reply: params.reply });
    }

    await this.state.finished({
      objectPath: found.object.path,
      directivePath: found.file.path,
      directive: found.file.name,
      stage: stage.name,
      marksDone: stage.marksDone,
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
