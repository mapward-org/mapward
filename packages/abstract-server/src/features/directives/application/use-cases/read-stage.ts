import type { FileReader } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { defaultStageText } from "../../../../kernel/default-workflow.ts";
import { noStage, pickStage, stageBody } from "../../domain/stages.ts";
import type { DirectiveLocator } from "../services/directive-locator.ts";

/**
 * Текст этапа без его запуска. Запуск ставит отметку о прогоне, и раньше это был единственный
 * способ прочитать этап: агент, которому нужно было посмотреть на соседний этап, либо заводил
 * прогон, которого не было, либо шёл читать файл мимо карты — а у дефолтного этапа файла нет
 * вовсе.
 *
 * Имя этапа ищется в модели объекта, включая доставшиеся от прототипа, ровно как при запуске.
 */
export class ReadStage {
  constructor(
    private readonly locator: DirectiveLocator,
    private readonly reader: FileReader,
  ) {}

  async run(params: MapRef & { address: string; stage: string }) {
    const object = await this.locator.object(params, params.address);
    const stage = pickStage(object.workflow, params.stage);
    if (!stage) throw noStage(object.workflow, params.stage);

    const text = stage.path
      ? ((await this.reader.read(stage.path)) ?? "")
      : defaultStageText(stage.name);

    return {
      name: stage.name,
      order: stage.order,
      marksDone: stage.marksDone,
      // У дефолтного этапа файла нет: текст лежит в самом инструменте, и править его негде.
      ...(stage.path === "" ? { builtin: true } : { path: stage.path }),
      ...(stage.owner === undefined ? {} : { owner: stage.owner }),
      // Тело без frontmatter — то же, что уезжает в промпт прогона.
      text: stageBody(text),
    };
  }
}
