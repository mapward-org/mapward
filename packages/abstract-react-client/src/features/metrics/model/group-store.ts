import type { ComponentBuild, MapMetric, MapObject, MetricGroup } from "@mapward/core";
import { Reactive, type Watchable } from "../../../lib/store/reactive.ts";
import { layoutProps, type LayoutPropsOf } from "../pure-model/group.ts";
import { soloGrid } from "../pure-model/grid.ts";

/** Сборка раскладки группы — ресурс: подписана, пока раскладка на экране. */
export type LayoutBuild = Watchable & { value: ComponentBuild | undefined };

/** Откуда группа берёт сборку своей раскладки: по объекту и ключу группы. */
export type LayoutBuilds = { layout(address: string, group: string): LayoutBuild };

/** Что показать: объект, метрики вкладки, её группу, одну метрику во всю ширину. */
export type GroupInput = {
  object: MapObject;
  /** Метрики вкладки в порядке группы. */
  metrics: MapMetric[];
  /** Открытая группа; у объекта без групп её нет. */
  group?: MetricGroup | undefined;
  /** Одна метрика во всю ширину — таб метрики (решение 0026). */
  solo?: string | undefined;
  /** Компактный вид — превью объекта: клетки без шапки, имя и кнопки при наведении. */
  compact?: boolean | undefined;
};

/**
 * Как группа показывает свои метрики:
 * - `layout` — компонентом раскладки из поля `layout` группы: он получает метрики и сам решает,
 *   что и где поставить;
 * - `list` — раскладки нет: вертикальный список, по метрике на строку, в порядке группы;
 * - `solo` — таб одной метрики: она на весь таб, раскладывать нечего.
 */
export type GroupMode = "layout" | "list" | "solo";

/**
 * Группа метрик на экране — решения 0025 и 0029. Что показать, решает группа, как поставить —
 * её раскладка. Метрику собирает её клетка, пока смонтирована: что раскладка не поставила, на то
 * и не подписано.
 *
 * Что показать, группа получает при создании и больше не меняет: другая вкладка или объект —
 * другая группа. Меняется только сборка раскладки — от неё она и зависит.
 */
export class GroupStore extends Reactive {
  private readonly build: LayoutBuild | undefined;

  constructor(
    private readonly input: GroupInput,
    builds: LayoutBuilds,
  ) {
    super();
    const group = input.group;
    // Таб одной метрики раскладку не спрашивает: собирать её ради одной клетки незачем.
    this.build =
      input.solo === undefined && group?.layout !== undefined
        ? builds.layout(input.object.address, group.key)
        : undefined;
    if (this.build) this.depend(this.build);
  }

  get mode(): GroupMode {
    if (this.input.solo !== undefined) return "solo";
    return this.build ? "layout" : "list";
  }

  get object(): MapObject {
    return this.input.object;
  }

  /** Метрики строками списка — в порядке группы; в табе — одна. */
  get metrics(): MapMetric[] {
    const solo = this.input.solo;
    return solo === undefined
      ? this.input.metrics
      : this.input.metrics.filter((metric) => metric.key === solo);
  }

  get isSolo(): boolean {
    return this.input.solo !== undefined;
  }

  get isCompact(): boolean {
    return this.input.compact === true;
  }

  /** Сетка таба одной метрики — один трек на всю ширину и высоту. */
  get soloStyle(): { gridTemplateColumns: string; gridTemplateRows: string } | undefined {
    const solo = this.input.solo;
    if (solo === undefined) return undefined;
    const grid = soloGrid(solo);
    return { gridTemplateColumns: grid.columns, gridTemplateRows: grid.rows };
  }

  /** Сборка раскладки; `undefined` — ещё собирается или раскладки нет. */
  get layoutBuild(): ComponentBuild | undefined {
    return this.build?.value;
  }

  /** Пропсы раскладки: узел метрики рисует вид, группа только раскладывает их по ключам. */
  layoutProps<N>(node: (metric: MapMetric) => N): LayoutPropsOf<N> | undefined {
    const group = this.input.group;
    return group ? layoutProps(this.input.object, group, this.input.metrics, node) : undefined;
  }
}
