import type { FileReader, FileWriter } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";
import { directiveStatePath } from "../../../../kernel/directive-files.ts";
import { isDirectiveName } from "../../domain/directive-name.ts";

/**
 * Удалить директиву целиком: вместе с файлом уходит состояние её прогонов — где оно лежит,
 * знает карта, и чистит его сервер, а не хост. Случайно созданная директива должна уметь
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
    await this.writer.remove(directiveStatePath(params.objectPath, params.directive));
    return { deleted: true };
  }
}
