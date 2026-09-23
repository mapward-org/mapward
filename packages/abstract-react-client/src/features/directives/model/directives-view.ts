import type { MapFile, MapObject, MapStage } from "@mapward/core";
import { activeDirectives, newestFirst } from "../../../kernel/directives.ts";

/** Как директивы удаляются и заводятся: через хост. */
export type DirectiveWrites = {
  create(objectPath: string): void;
  remove(objectPath: string, directive: string): void;
};

/**
 * Директивы объекта в двух местах — решение 0024: незакрытые под названием объекта и все в
 * мета-экране. Что где показывать, решает этот стор; как выглядит список, — `ui`.
 */
export class DirectivesView {
  constructor(
    private readonly object: () => MapObject,
    private readonly writes: DirectiveWrites,
  ) {}

  /** Незакрытые — на первом экране, в порядке файлов. */
  get active(): MapFile[] {
    return activeDirectives(this.object().directives);
  }

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
