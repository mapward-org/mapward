import type { FileReader, FileWriter } from "../../../../ports/index.ts";

/**
 * Реплика в тред — решение 0039. Дописывается в конец, а не переписывает файл: автор правит тот
 * же файл, пока агент думает, и всё, что выше конца, остаётся как есть. Перед репликой — пустая
 * строка: без неё реплика прилипает к последней строке автора, у которой часто нет перевода
 * строки, и цитата `> [AI]` перестаёт быть цитатой.
 */
export class DirectiveThread {
  constructor(
    private readonly reader: FileReader,
    private readonly writer: FileWriter,
  ) {}

  async append(params: { directivePath: string; reply: string }): Promise<void> {
    const text = (await this.reader.read(params.directivePath)) ?? "";
    const reply = params.reply.replace(/\s+$/, "");
    if (reply.length === 0) return;

    const gap =
      text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    await this.writer.write(params.directivePath, `${text}${gap}${reply}\n`);
  }
}
