import * as T from "typebox";
import type { Static } from "typebox";

/** `_index.json` as decision 0003 describes it. Everything is optional: any field may be inherited. */
export const LayoutVariant = T.Object({
  areas: T.Array(T.Array(T.String())),
  style: T.Optional(T.Record(T.String(), T.String())),
});

export const Layout = T.Union([LayoutVariant, T.Record(T.String(), LayoutVariant)]);

export const ObjectIndex = T.Object({
  name: T.Optional(T.String()),
  props: T.Optional(T.Record(T.String(), T.Unknown())),
  extends: T.Optional(T.String()),
  "preview-size": T.Optional(T.Object({ w: T.Number(), h: T.Number() })),
  "preview-metrics-layout": T.Optional(Layout),
  "details-metrics-layout": T.Optional(Layout),
  "preview-style": T.Optional(T.Record(T.String(), T.String())),
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
  collectors: T.Optional(T.Array(T.Record(T.String(), T.Unknown()))),
  transformsCache: T.Optional(T.Boolean()),
  transformsStaleTime: T.Optional(T.Number()),
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
