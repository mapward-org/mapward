import { computed, makeObservable } from "mobx";
import type { Layout, MapAction, MapMetric, MapObject } from "@mapward/core";
import { ago, toDisplay, type DisplayData } from "../pure-model/display.ts";
import { planGrid, soloGrid, type GridPlan } from "../pure-model/grid.ts";
import {
  DEFAULT_TREE,
  treeOpen,
  type OpenFolders,
  type TreeOpen,
} from "../pure-model/tree-open.ts";

/** Значение метрики, как его присылает сервер (решение 0013). */
export type MetricValue = {
  updatedAt?: string;
  ok?: boolean;
  data?: unknown;
  busy?: boolean;
  loading?: boolean;
  invalid?: string[];
};

/** Откуда сетка берёт значения и чем обновляет метрику. */
export type GridValues = {
  values: Record<string, MetricValue>;
  run(metric: MapMetric): void;
};

/** Состояние вида одного ключа — у человека, в хранилище редактора. */
export type GridSlot<T> = { value: T; ready: boolean; set(value: T): void };
export type GridViews = { slot<T>(key: string, initial: T): GridSlot<T> };

/** Что сетка показывает: объект, метрики вкладки, раскладку, одну метрику во всю ширину. */
export type GridInput = {
  object: MapObject;
  metrics: MapMetric[];
  layout?: Layout | undefined;
  solo?: string | undefined;
  /** Экшоны, которые раскладка может поставить в клетку: ключ в `areas`, как у метрики. */
  cells: () => MapAction[];
};

/** Клетка метрики со всем, что про неё показывается. */
export type GridCell = {
  metric: MapMetric;
  label: string;
  value: MetricValue | undefined;
  freshness: string | undefined;
  busy: boolean;
  /** Последний прогон упал — красная точка ведёт на него (решение 0038). */
  failed: boolean;
  hidden: boolean;
  data: DisplayData;
  collected: boolean;
  /** Снимка ещё нет или метрика ещё поднимается — это загрузка, а не «не собиралась». */
  pending: boolean;
  empty: string | undefined;
  tree: TreeOpen;
  treeOf: (id: string) => TreeOpen;
  component: boolean;
};

let grids = 0;

/**
 * Сетка метрик — решения 0029 и 0033. Раскладка — это css под своим классом, клетки метрик и
 * экшонов ставит он же по ключу. Метрики, которых раскладка не назвала, не показываются и не
 * собираются: отбор идёт до подписки.
 *
 * Свёрнутость и раскрытые папки деревьев — удобство человека: помнит редактор, в репозиторий они
 * не попадают. То, что человек свернул руками, выигрывает у `collapsed` метрики (решение 0010).
 */
export class GridStore {
  /** Правила сетки лежат под своим классом: две сетки на экране не должны задевать друг друга. */
  readonly scope = `mw-grid-${++grids}`;
  private readonly folded: GridSlot<Record<string, boolean>>;
  private readonly folders: GridSlot<Record<string, OpenFolders>>;

  constructor(
    private readonly input: GridInput,
    private readonly source: GridValues,
    views: GridViews,
  ) {
    const address = input.object.address;
    this.folded = views.slot<Record<string, boolean>>(`folded:${address}`, {});
    this.folders = views.slot<Record<string, OpenFolders>>(`tree-open:${address}`, {});
    makeObservable(this, {
      plan: computed,
      solo: computed,
      metrics: computed,
      actions: computed,
      cells: computed,
    });
  }

  /**
   * Одна метрика во всю ширину — таб метрики (решение 0026). Сетка тогда не раскладывается:
   * раскладывать нечего, и лишние клетки съели бы место, ради которого таб и открывали.
   */
  get solo(): ReturnType<typeof soloGrid> | undefined {
    return this.input.solo === undefined ? undefined : soloGrid(this.input.solo);
  }

  get plan(): GridPlan | undefined {
    if (this.solo) return undefined;
    // Ключ экшона раскладка называет так же, как ключ метрики, и клетка у него своя.
    return planGrid(
      this.input.layout,
      [
        ...this.input.metrics.map((metric) => metric.key),
        ...this.input.cells().map((action) => action.key),
      ],
      this.scope,
    );
  }

  private get placed(): Set<string> | undefined {
    return this.solo?.placed ?? this.plan?.placed;
  }

  /** Раскладка есть — показываются метрики, которые в ней названы, и только они (0029). */
  get metrics(): MapMetric[] {
    const placed = this.placed;
    return placed
      ? this.input.metrics.filter((metric) => placed.has(metric.key))
      : this.input.metrics;
  }

  /** Без раскладки экшонов в сетке нет: стопкой метрик их ставить некуда, они живут в шапке. */
  get actions(): MapAction[] {
    const plan = this.plan;
    return plan ? this.input.cells().filter((action) => plan.placed.has(action.key)) : [];
  }

  get css(): string | undefined {
    return this.plan?.css;
  }

  get isSolo(): boolean {
    return this.solo !== undefined;
  }

  /** Сетка таба одной метрики — один трек на всю ширину и высоту. */
  get soloStyle(): { gridTemplateColumns: string; gridTemplateRows: string } | undefined {
    const solo = this.solo;
    return solo ? { gridTemplateColumns: solo.columns, gridTemplateRows: solo.rows } : undefined;
  }

  get cells(): GridCell[] {
    const values = this.source.values;
    // `updatedAt` — время получения содержимого, а не чтения (0013): значение живёт в сторе и
    // переживает уход с объекта. Нет значения — `ago` сам вернёт ничего.
    const now = Date.now();
    return this.metrics.map((metric) => {
      const value = values[metric.address];
      return {
        metric,
        label: metric.config.label ?? metric.key,
        value,
        freshness: ago(value?.updatedAt, now),
        busy: value?.busy === true,
        failed: value?.busy !== true && value?.ok === false,
        hidden: this.isFolded(metric),
        data: toDisplay(metric.config.display?.kind, value?.data),
        collected: value?.data !== undefined,
        pending: value === undefined || value.loading === true,
        empty: metric.config.display?.empty,
        tree: this.tree(metric.key, DEFAULT_TREE),
        treeOf: (id: string) => this.tree(metric.key, id),
        component: metric.config.display?.kind === "component",
      };
    });
  }

  /** В табе одной метрики свёрнутость не спрашивается: таб открыт ради того, чтобы её видеть. */
  private isFolded(metric: MapMetric): boolean {
    if (this.input.solo === metric.key) return false;
    return this.folded.value[metric.key] ?? metric.config.collapsed ?? false;
  }

  toggle(metric: MapMetric): void {
    this.folded.set({ ...this.folded.value, [metric.key]: !this.isFolded(metric) });
  }

  refresh(metric: MapMetric): void {
    this.source.run(metric);
  }

  /** Раскрытые папки дерева метрики: одни и те же в сетке и в табе метрики. */
  private tree(key: string, id: string): TreeOpen {
    const state = this.folders.value[key] ?? {};
    return treeOpen(state, this.folders.ready, id, (next) =>
      this.folders.set({ ...this.folders.value, [key]: next }),
    );
  }
}
