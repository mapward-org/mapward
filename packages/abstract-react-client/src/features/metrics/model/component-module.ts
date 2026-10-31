import type { ComponentBuild } from "@mapward/core";

type Loaded<V> = { view?: V; error?: string };

/**
 * Компонент метрики — решение 0037: что рисовать в ячейке. Код и css приносит сервер; пока
 * сборки нет — «собирается», не собрался, не загрузился — ошибка.
 */
export class ComponentModule<V> {
  constructor(
    private readonly build: ComponentBuild | undefined,
    private readonly load: (code: string) => Loaded<V>,
  ) {}

  private get loaded(): Loaded<V> {
    const code = this.build?.code;
    return code === undefined ? {} : this.load(code);
  }

  get building(): boolean {
    return this.build === undefined;
  }

  get failure(): { title: string; lines: string[] } | undefined {
    const build = this.build;
    if (!build) return undefined;
    if (build.errors && build.errors.length > 0) {
      return { title: "компонент не собрался", lines: build.errors };
    }
    const loaded = this.loaded;
    if (loaded.error || !loaded.view) {
      return { title: "компонент не загрузился", lines: [loaded.error ?? "нет кода"] };
    }
    return undefined;
  }

  get view(): V | undefined {
    return this.failure ? undefined : this.loaded.view;
  }

  get css(): string | undefined {
    return this.build?.css;
  }

  get builtAt(): string {
    return this.build?.builtAt ?? "";
  }
}
