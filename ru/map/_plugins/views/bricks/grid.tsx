import { useId, useMemo, type ReactNode } from "react";
import type { LayoutMetric } from "@mapward/component";
import { cellAttribute, gridCells, gridOf, planGrid, type GridVariant } from "./grid-plan.ts";

/**
 * Сетка метрик — решения 0029 и 0033: css grid по именам клеток. `children` — что ставить по
 * местам, по ключу: метрики раскладки как есть (`{metrics}`) или вперемешку со своим, например
 * `ActionButton`. Ставится и монтируется только то, что названо в `areas`.
 *
 * `variants` — сетки по ширине контейнера: ключ — условие `@container`, как `min-width: 600px`.
 * Порядок ключей — порядок правил, побеждает последний подошедший; первым ставится тот, что
 * подходит всегда (`min-width: 0px`). В варианте, где ключа нет, его клетка скрыта.
 */
export function Grid(
  props: Partial<GridVariant> & {
    variants?: Record<string, GridVariant>;
    children: Record<string, ReactNode | LayoutMetric>;
  },
) {
  // Правила лежат под своим классом: две сетки на экране не должны задевать друг друга.
  const scope = `mw-grid-${useId().replace(/[^\w-]/g, "")}`;
  const layout = gridOf(props);
  const keys = Object.keys(props.children);
  // Раскладка пишет `areas` литералом, и новый массив приходит на каждую отрисовку: план
  // помнится по содержимому — новый `<style>` на каждый кадр перекладывал бы сетку.
  const key = JSON.stringify([layout, keys]);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planGrid(layout, keys, scope), [key, scope]);
  const cells = plan ? gridCells<ReactNode>(props.children, plan.placed) : [];

  return (
    <div className={`${scope} grid content-start gap-2`}>
      {plan?.css && <style>{plan.css}</style>}
      {cells.map(([area, node]) => (
        <div key={area} {...{ [cellAttribute]: area }} className="min-h-0 min-w-0">
          {node}
        </div>
      ))}
    </div>
  );
}
