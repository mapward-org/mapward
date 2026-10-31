import type { ComponentBuild } from "@mapward/core";

type Loaded<V> = { view?: V; error?: string };

/**
 * Компонент метрики — решение 0037: что рисовать в ячейке. Код и css приносит сервер; пока
 * сборки нет — «собирается», не собрался, не загрузился — ошибка.
 *
 * Слой всплывающих окон — решение 0048: css компонента действует только под его меткой, и меню,
 * вынесенное поверх карты, рисуется в свой элемент в `body` с той же меткой. Заводится по первой
 * просьбе и уходит вместе с клеткой.
 */
export class ComponentModule<V> {
  private floating: HTMLElement | undefined;

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

  /** Метка компонента — атрибут `data-mw-component` клетки и слоя окон. */
  get scope(): string | undefined {
    return this.build?.scope;
  }

  /** Слой всплывающих окон компонента: элемент в `body` с его меткой. */
  readonly layer = (): HTMLElement => {
    if (!this.floating) {
      const element = document.createElement("div");
      element.setAttribute("data-mw-component", this.scope ?? "");
      document.body.append(element);
      this.floating = element;
    }
    return this.floating;
  };

  unmount(): void {
    this.floating?.remove();
    this.floating = undefined;
  }
}
