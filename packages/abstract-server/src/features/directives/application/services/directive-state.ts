import type { FileReader, FileWriter } from "../../../../ports/index.ts";
import { directiveStatePath } from "@mapward/core";

/**
 * Состояние прогона пишет сервер, а не агент — решение 0017. Агент сообщает событие: этап
 * начался, этап кончился. Формат состояния и копия текста — внутреннее дело карты.
 *
 * Копия снимается только этапом, которому поручено помечать выполнение: по ней потом видно,
 * менялась ли директива после того, как её сделали. Этап без такого поручения оставляет след
 * о прогоне, но директива остаётся незакрытой.
 */
export type DirectiveStateFile = {
  directive?: string;
  status?: "done";
  ran?: string;
  run?: { stage: string; startedAt: string; finishedAt?: string };
  /**
   * Сколько раз какой этап начинали. Полной истории прогонов здесь нет намеренно: она растёт
   * без предела, а спрашивают у неё одно — сколько кругов уже прошло. Счётчик отвечает на это
   * и не меняет формат состояния, а дополняет его.
   */
  runs?: Record<string, number>;
};

/** Файл состояния прогонов директивы: его читают и пишут оба юзкейса этапа. */
export class DirectiveState {
  constructor(
    private readonly reader: FileReader,
    private readonly writer: FileWriter,
  ) {}

  async started(params: {
    objectPath: string;
    directive: string;
    stage: string;
    now: Date;
  }): Promise<void> {
    const state = await this.read(params.objectPath, params.directive);
    // Считается начало, а не конец: прогон, брошенный на середине, — тоже круг, и по счётчику
    // это должно быть видно.
    const runs = { ...state.runs, [params.stage]: (state.runs?.[params.stage] ?? 0) + 1 };
    await this.write(params.objectPath, params.directive, {
      ...state,
      runs,
      run: { stage: params.stage, startedAt: params.now.toISOString() },
    });
  }

  async finished(params: {
    objectPath: string;
    directivePath: string;
    directive: string;
    stage: string;
    marksDone: boolean;
    now: Date;
  }): Promise<void> {
    const state = await this.read(params.objectPath, params.directive);
    const run = {
      stage: params.stage,
      startedAt: state.run?.stage === params.stage ? state.run.startedAt : params.now.toISOString(),
      finishedAt: params.now.toISOString(),
    };

    if (!params.marksDone) {
      await this.write(params.objectPath, params.directive, { ...state, run });
      return;
    }

    // Копия нужна побайтно: пересказ ломает сравнение, по которому выполненная директива
    // отличается от изменившейся.
    const text = await this.reader.read(params.directivePath);
    await this.write(params.objectPath, params.directive, {
      ...state,
      directive: text ?? "",
      status: "done",
      ran: params.now.toISOString(),
      run,
    });
  }

  private async read(objectPath: string, directive: string): Promise<DirectiveStateFile> {
    const raw = await this.reader.read(directiveStatePath(objectPath, directive));
    if (raw === undefined) return {};
    try {
      return JSON.parse(raw) as DirectiveStateFile;
    } catch {
      return {};
    }
  }

  private write(objectPath: string, directive: string, state: DirectiveStateFile) {
    return this.writer.write(
      directiveStatePath(objectPath, directive),
      `${JSON.stringify(state, null, 2)}\n`,
    );
  }
}
