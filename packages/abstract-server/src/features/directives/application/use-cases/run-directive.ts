import type { FileReader } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { defaultStageText } from "../../../../kernel/default-workflow.ts";
import { promptFingerprint, stagePrompt } from "../../domain/prompts.ts";
import { noStage, pickStage, stageBody } from "../../domain/stages.ts";
import type { DirectiveTurns } from "../../ports.ts";
import type { DirectiveLocator } from "../services/directive-locator.ts";
import type { DirectiveState } from "../services/directive-state.ts";

/**
 * Взять директиву в работу: промпт этапа плюс отметка, что прогон начался — решение 0017.
 * Один вызов вместо двух потому, что промпт без отметки означал бы прогон, которого карта
 * не видит, а это ровно то, от чего уходили.
 */
export class RunDirective {
  constructor(
    private readonly locator: DirectiveLocator,
    private readonly reader: FileReader,
    private readonly state: DirectiveState,
    private readonly turns: DirectiveTurns,
  ) {}

  async run(
    params: MapRef & { address: string; directive: string; stage?: string; known?: string },
  ) {
    const found = await this.locator.directive(params);
    const stage = pickStage(found.stages, params.stage);
    if (!stage) throw noStage(found.stages, params.stage);

    const text = stage.path
      ? ((await this.reader.read(stage.path)) ?? "")
      : defaultStageText(stage.name);

    await this.state.started({
      objectPath: found.object.path,
      directive: found.file.name,
      stage: stage.name,
      now: new Date(),
    });
    // Этап начался — человек взял ход, директива больше не ждёт ответа (решение 0034).
    this.turns.taken({
      mapPath: params.mapPath,
      address: found.object.address,
      directive: found.file.name,
    });

    const prompt = stagePrompt({
      stage,
      text: stageBody(text),
      hook: found.object.workflowPrompt,
      directivePath: found.file.path,
      object: found.object,
      mapPath: params.mapPath,
    });
    const promptHash = promptFingerprint(prompt);
    const head = { stage: stage.name, marksDone: stage.marksDone, directive: found.file.path };

    // Тот же текст второй раз — пять килобайт на круг, которые агент уже держит в контексте
    // (решение 0039). Отпечаток называет сам агент: сервер не знает, какая сессия зовёт, и
    // новая, ничего не назвав, получает промпт целиком.
    return params.known === promptHash
      ? { ...head, unchanged: true, promptHash }
      : { ...head, promptHash, prompt };
  }
}
