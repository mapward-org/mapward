import * as T from "typebox";
import type { Static } from "typebox";

/** `_index.json` as decision 0003 describes it. Everything is optional: any field may be inherited. */
export const LayoutVariant = T.Object({
  areas: T.Array(T.Array(T.String())),
  style: T.Optional(T.Record(T.String(), T.String())),
});

export const Layout = T.Union([LayoutVariant, T.Record(T.String(), LayoutVariant)]);

/**
 * Группа метрик — решение 0025: вкладка объекта со своим набором метрик.
 *
 * Группа живёт у объекта, а не у метрики: у неё есть описание, порядок и своя раскладка, а
 * метрике из `shared-metrics` положить их некуда — она достаётся многим объектам сразу.
 */
export const MetricGroup = T.Object({
  key: T.String(),
  /** Подпись вкладки; без неё вкладка подписана ключом. */
  label: T.Optional(T.String()),
  /** Что это за набор — markdown над сеткой. */
  description: T.Optional(T.String()),
  /** Ключи метрик. Метрика, не названная ни в одной группе, не показывается и не собирается. */
  metrics: T.Array(T.String()),
  /** Своя раскладка вкладки; без неё берётся `details-metrics-layout` объекта. */
  "details-metrics-layout": T.Optional(Layout),
});

export const MetricGroups = T.Object({
  /** Мерджить унаследованные группы по ключу или заменить их целиком — как у воркфлоу. */
  mode: T.Optional(T.Union([T.Literal("merge"), T.Literal("replace")])),
  groups: T.Array(MetricGroup),
});

export const ObjectIndex = T.Object({
  name: T.Optional(T.String()),
  props: T.Optional(T.Record(T.String(), T.Unknown())),
  extends: T.Optional(T.String()),
  "preview-size": T.Optional(T.Object({ w: T.Number(), h: T.Number() })),
  "preview-metrics-layout": T.Optional(Layout),
  "details-metrics-layout": T.Optional(Layout),
  "preview-style": T.Optional(T.Record(T.String(), T.String())),
  // Решение 0018: то, что карта говорит своему терминалу поверх сказанного инструментом.
  // Доезжает до промпта терминала и до промпта этапа: правило объекта не зависит от того,
  // запущена директива или нет.
  prompt: T.Optional(T.String()),
  // Решение 0017: чем этапы объекта отличаются от унаследованных и что примешивается
  // к промпту любого из них. Сами этапы — файлы в `_directives.workflow/`.
  "directives-workflow": T.Optional(
    T.Object({
      mode: T.Optional(T.Union([T.Literal("merge"), T.Literal("replace")])),
      prompt: T.Optional(T.String()),
    }),
  ),
  // Решение 0025: вкладки объекта. Заданы — метрики вне групп не показываются и не собираются:
  // так унаследованную метрику можно не использовать, не отказываясь от прототипа.
  "metric-groups": T.Optional(MetricGroups),
});

/** Metric `config.json` as decision 0004 describes it. */
export const MetricConfig = T.Object({
  label: T.Optional(T.String()),
  extends: T.Optional(T.String()),
  refresh: T.Optional(T.String()),
  collectorsCache: T.Optional(T.Boolean()),
  // Decision 0013: how long a result counts as fresh, in milliseconds. While it is fresh,
  // opening the object starts no run at all.
  collectorsStaleTime: T.Optional(T.Number()),
  // Decision 0016: how long a stage may run, in milliseconds. A caller may pass its own and
  // override this; there is no global setting, since the duration belongs to the metric.
  collectorsTimeout: T.Optional(T.Number()),
  collectors: T.Optional(T.Array(T.Record(T.String(), T.Unknown()))),
  transformsCache: T.Optional(T.Boolean()),
  transformsStaleTime: T.Optional(T.Number()),
  transformsTimeout: T.Optional(T.Number()),
  transforms: T.Optional(T.Array(T.Record(T.String(), T.Unknown()))),
  display: T.Optional(
    T.Object({
      kind: T.String(),
      // Decision 0010: what to say when there is nothing to show — an error would be a lie.
      empty: T.Optional(T.String()),
    }),
  ),
  // Decision 0010: a metric may come folded; what the person folds by hand wins over it.
  collapsed: T.Optional(T.Boolean()),
});

export type LayoutVariant = Static<typeof LayoutVariant>;
export type Layout = Static<typeof Layout>;
export type MetricGroup = Static<typeof MetricGroup>;
export type MetricGroups = Static<typeof MetricGroups>;
export type ObjectIndex = Static<typeof ObjectIndex>;
export type MetricConfig = Static<typeof MetricConfig>;

/** A layout may be one variant or a dictionary keyed by container query — see decision 0003. */
export function layoutVariants(
  layout: Layout | undefined,
): { query?: string; variant: LayoutVariant }[] {
  if (!layout) return [];
  if ("areas" in layout) return [{ variant: layout as LayoutVariant }];
  return Object.entries(layout).map(([query, variant]) => ({ query, variant }));
}
