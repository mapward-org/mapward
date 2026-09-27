import type { MapFile, MapObject, MapStage } from "@mapward/core";
import { newestFirst } from "../../../kernel/directives.ts";

/** Как директивы удаляются и заводятся: через хост. */
export type DirectiveWrites = {
  create(objectPath: string): void;
  remove(objectPath: string, directive: string): void;
};

/**
 * Директивы объекта списком мета-экрана и заведение новой: незакрытые живут в меню на кнопке
 * (решение 0045), а все — здесь. Что показывать, решает этот стор; как выглядит список, — `ui`.
 */
export class DirectivesView {
  constructor(
    private readonly object: () => MapObject,
    private readonly writes: DirectiveWrites,
  ) {}

  /** Архив мета-экрана — свежие сверху. */
  archive(files: MapFile[]): MapFile[] {
    return newestFirst(files);
  }

  get stages(): MapStage[] {
    return this.object().workflow;
  }

  create(): void {
    this.writes.create(this.object().path);
  }

  remove(file: MapFile): void {
    this.writes.remove(this.object().path, file.name);
  }
}
