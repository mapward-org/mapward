import type { Layout, LayoutVariant } from "../../pure-model/schema.ts";
import { layoutVariants } from "../../pure-model/schema.ts";

export type GridPlan = {
  areas: string;
  columns: string;
  style: Record<string, string>;
  placed: Set<string>;
};

/**
 * A layout may hold several variants keyed by container query. Picking one here keeps the
 * component free of measuring: the sidebar has one width at a time.
 */
export function planGrid(layout: Layout | undefined, keys: string[]): GridPlan | undefined {
  const variants = layoutVariants(layout);
  const chosen: LayoutVariant | undefined = variants.at(-1)?.variant;
  if (!chosen) return undefined;

  const width = Math.max(...chosen.areas.map((row) => row.length), 1);
  const placed = new Set(chosen.areas.flat().filter((name) => name !== "."));

  return {
    areas: chosen.areas.map((row) => `"${row.join(" ")}"`).join(" "),
    columns: `repeat(${width}, minmax(0, 1fr))`,
    style: chosen.style ?? {},
    // A metric missing from the layout is not hidden: it falls outside the grid areas,
    // as decision 0003 says.
    placed: new Set([...placed, ...keys.filter((key) => !placed.has(key))]),
  };
}
