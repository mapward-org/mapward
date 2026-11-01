import type { FileReader, FileWriter } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";
import { isDirectiveName } from "../../domain/directive-name.ts";

/**
 * Удалить директиву: её состояние лежит в ней же, во frontmatter, и уходит вместе с файлом. Случайно созданная директива должна уметь
 * исчезнуть, иначе список копит мусор.
 *
 * Удаляется только своя: доставшаяся от прототипа лежит в чужой папке, и в `_directives`
 * этого объекта её нет — тогда удалять нечего, и это не ошибка, а ответ `deleted: false`.
 */
export class DeleteDirective {
  constructor(
    private readonly reader: FileReader,
    private readonly writer: FileWriter,
  ) {}

  async run(params: { objectPath: string; directive: string }): Promise<{ deleted: boolean }> {
    if (!isDirectiveName(params.directive)) {
      throw new Error(`Не имя директивы: ${params.directive}`);
    }

    const path = join(params.objectPath, "_directives", params.directive);
    if ((await this.reader.read(path)) === undefined) return { deleted: false };

    await this.writer.remove(path);
    return { deleted: true };
  }
}
