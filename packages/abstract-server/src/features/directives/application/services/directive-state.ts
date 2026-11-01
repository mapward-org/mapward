import type { FileReader, FileWriter } from "../../../../ports/index.ts";
import {
  readDirectiveState,
  stageFinished,
  stageStarted,
  writeDirectiveState,
} from "../../../../kernel/directive-state.ts";
import { appendReply } from "../../domain/thread.ts";

/**
 * Состояние прогона пишет сервер, а не агент — решение 0017. Агент сообщает событие: этап
 * начался, этап кончился. Лежит состояние во frontmatter самой директивы: файла рядом нет, и
 * копии текста тоже — отслеживать изменения директивы не нужно, она меняется после каждого этапа.
 */
export class DirectiveState {
  constructor(
    private readonly reader: FileReader,
    private readonly writer: FileWriter,
  ) {}

  async started(params: { directivePath: string; stage: string }): Promise<void> {
    const text = (await this.reader.read(params.directivePath)) ?? "";
    const state = stageStarted(readDirectiveState(text), params.stage);
    await this.writer.write(params.directivePath, writeDirectiveState(text, state));
  }

  /**
   * Реплика и статус — одной записью: автор правит тот же файл, пока агент думает, и две записи
   * подряд — два шанса разойтись с его правкой.
   */
  async finished(params: {
    directivePath: string;
    stage: string;
    marksDone: boolean;
    reply?: string;
    now: Date;
  }): Promise<void> {
    const read = (await this.reader.read(params.directivePath)) ?? "";
    const text = params.reply === undefined ? read : appendReply(read, params.reply);
    const state = stageFinished(readDirectiveState(text), params);
    await this.writer.write(params.directivePath, writeDirectiveState(text, state));
  }
}
