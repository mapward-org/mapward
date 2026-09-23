import type { AppBridge, BridgeClient } from "@mapward/core";

/**
 * Директивы файлами — через хост: имя новой спрашивает он, удаление подтверждает он, а пишет и
 * удаляет сервер. Список обновится сам — карта следит за своими файлами.
 */
export class DirectiveFiles {
  constructor(private readonly bridge: BridgeClient<AppBridge>) {}

  create(objectPath: string): void {
    void this.bridge.createDirective({ objectPath });
  }

  remove(objectPath: string, directive: string): void {
    void this.bridge.deleteDirective({ objectPath, directive });
  }
}
