import type { ReactNode } from "react";
import { cellAttribute } from "../pure-model/grid.ts";

/**
 * Рамка сетки метрик. Высоту сетке код не задаёт (решение 0033): она растёт по содержимому, а
 * прокручивается область вокруг. Таб одной метрики — исключение: там метрика и есть весь экран.
 *
 * `content-start` прижимает ряды кверху, когда сетке досталось больше места, чем нужно
 * метрикам: иначе css растягивает ряды `auto` на весь остаток. Ряд `1fr` это не трогает.
 */
export function GridFrame(props: {
  scope: string;
  /** Правила раскладки — тегом `<style>` рядом с сеткой. */
  css?: string | undefined;
  solo?: { gridTemplateColumns: string; gridTemplateRows: string } | undefined;
  /** Компактный вид: поля и зазоры минимальные, левого поля под свёртку нет — свёртки нет. */
  compact?: boolean | undefined;
  children: ReactNode;
}) {
  const space = props.compact ? "gap-1 p-1" : "gap-2 p-2 pl-6";
  return (
    <div
      className={`${props.scope} grid content-start ${space} ${props.solo ? "h-full min-h-0" : ""}`}
      {...(props.solo ? { style: props.solo } : {})}
    >
      {props.css && <style>{props.css}</style>}
      {props.children}
    </div>
  );
}

/** Клетка экшона: та же метка, что у клетки метрики, — место назначает css раскладки. */
export function ActionCell(props: { cell: string; children: ReactNode }) {
  return (
    <div {...{ [cellAttribute]: props.cell }} className="min-w-0">
      {props.children}
    </div>
  );
}
