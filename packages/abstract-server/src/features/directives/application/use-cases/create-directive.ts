import type { FileWriter } from "../../../../ports/index.ts";
import { join } from "../../../../lib/path.ts";
import { directiveName } from "../../domain/directive-name.ts";

/**
 * Пустая директива — приглашение писать: файл создаётся и отдаётся приложению, а открыть его
 * в редакторе умеет только хост.
 */
export class CreateDirective {
  constructor(private readonly writer: FileWriter) {}

  async run(params: { objectPath: string; title: string }): Promise<{ path: string }> {
    const path = join(params.objectPath, "_directives", directiveName(params.title, new Date()));
    await this.writer.write(path, "\n## \n\n");
    return { path };
  }
}
