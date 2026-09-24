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
  /**
   * Эта вкладка — превью объекта: её показывает карточка, которой группу не назвали. Отдельного
   * описания у превью нет — карточка берёт у вкладки метрики и раскладку.
   */
  defaultPreview: T.Optional(T.Boolean()),
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
  "details-metrics-layout": T.Optional(Layout),
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
      // Решение 0037: дисплей `component` — свой `.tsx` рядом с метрикой. Путь считается от
      // папки того `config.json`, где он написан: компонент прототипа лежит у прототипа.
      component: T.Optional(T.String()),
      // JSON-схема данных компонента: объектом или путём к `.json`, от той же папки.
      schema: T.Optional(T.Unknown()),
    }),
  ),
  // Decision 0010: a metric may come folded; what the person folds by hand wins over it.
  collapsed: T.Optional(T.Boolean()),
});

/**
 * Поле формы экшона — решение 0038. Названия взяты у ручного запуска GitHub Actions
 * (`workflow_dispatch.inputs`): формат свой, но тот, который агент и человек уже видели.
 */
export const ActionInput = T.Object({
  type: T.Optional(
    T.Union([T.Literal("string"), T.Literal("boolean"), T.Literal("number"), T.Literal("choice")]),
  ),
  description: T.Optional(T.String()),
  required: T.Optional(T.Boolean()),
  /** Проходит подстановку, как весь конфиг: умолчание берут из свойств объекта. */
  default: T.Optional(T.Union([T.String(), T.Number(), T.Boolean()])),
  /** Варианты для `choice`. */
  options: T.Optional(T.Array(T.String())),
  /** Многострочное поле для `string`: промпту часто нужен абзац, а не слово. */
  multiline: T.Optional(T.Boolean()),
});

/**
 * Что агенту экшона разрешено — решение 0038. `bypass` снимает вопросы целиком; список —
 * это инструменты и команды, которые ему можно, в том виде, что понимает `claude`.
 */
export const ActionPermissions = T.Union([T.Literal("bypass"), T.Array(T.String())]);

/** Экшон `config.json` — решение 0038: как метрика, но пишет, а не читает, и без трансформов. */
export const ActionConfig = T.Object({
  label: T.Optional(T.String()),
  description: T.Optional(T.String()),
  extends: T.Optional(T.String()),
  /** Спросить перед запуском, даже когда форма заполнена целиком. */
  confirm: T.Optional(T.Boolean()),
  /** Мс на весь прогон; вышло — прогон снимается и краснеет. */
  timeout: T.Optional(T.Number()),
  /** Шаги по порядку: `script`, `prompt` или вид, которого ещё нет. */
  runners: T.Optional(T.Array(T.Record(T.String(), T.Unknown()))),
  inputs: T.Optional(T.Record(T.String(), ActionInput)),
  /** Ключи метрик объекта, которые пересобираются после успешного прогона. */
  refreshes: T.Optional(T.Array(T.String())),
});

export type ActionInput = Static<typeof ActionInput>;
export type ActionPermissions = Static<typeof ActionPermissions>;
export type ActionConfig = Static<typeof ActionConfig>;
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
