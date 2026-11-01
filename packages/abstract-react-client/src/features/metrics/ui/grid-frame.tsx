import type { ReactNode } from "react";

/** Поля вокруг метрик. Свёртка клетки висит в левом поле, своего места ей не отводится. */
const space = (compact: boolean | undefined) => (compact ? "p-1" : "p-2");

/**
 * Группа без раскладки — вертикальный список, по метрике на строку. Высоту код не задаёт
 * (решение 0033): список растёт по содержимому, а прокручивается область вокруг. Таб одной
 * метрики — исключение: там метрика и есть весь экран, один трек на всю высоту.
 *
 * `content-start` прижимает строки кверху, когда места больше, чем нужно метрикам.
 */
export function GridFrame(props: {
  solo?: { gridTemplateColumns: string; gridTemplateRows: string } | undefined;
  /** Компактный вид: поля и зазоры минимальные. */
  compact?: boolean | undefined;
  children: ReactNode;
}) {
  const gap = props.compact ? "gap-1" : "gap-2";
  return (
    <div
      className={`grid content-start ${gap} ${space(props.compact)} ${props.solo ? "h-full min-h-0" : ""}`}
      {...(props.solo ? { style: props.solo } : {})}
    >
      {props.children}
    </div>
  );
}

/**
 * Рамка раскладки группы: поля вокруг, а как стоят метрики, решает раскладка. Во всю высоту
 * области — чтобы сетка раскладки со `height: 100%` растягивалась на экран.
 */
export function LayoutFrame(props: { compact?: boolean | undefined; children: ReactNode }) {
  return <div className={`h-full min-h-0 ${space(props.compact)}`}>{props.children}</div>;
}
