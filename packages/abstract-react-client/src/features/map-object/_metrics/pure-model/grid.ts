import type { Layout, LayoutVariant } from "@mapward/core";
import { layoutVariants } from "@mapward/core";

export type GridPlan = {
  /**
   * Именованные области. Их может не быть: раскладка на одну метрику обходится треками, и
   * тогда клетке нечего называть — `grid-area` с именем, которого в сетке нет, кладёт её
   * по несуществующей линии вместо того, чтобы отдать ей место (решение 0026).
   */
  areas?: string;
  columns: string;
  rows?: string;
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

/**
 * Таб одной метрики: раскладывать нечего, и раскладка тут не нужна — нужен один трек на всю
 * ширину и на всю высоту. Метрика в табе занимает его целиком, ради этого таб и открывали
 * (решение 0026).
 */
export function soloGrid(key: string): GridPlan {
  return {
    columns: "minmax(0, 1fr)",
    rows: "minmax(0, 1fr)",
    style: {},
    placed: new Set([key]),
  };
}
